import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  KNOWLEDGE_LIBRARY_FILE, KNOWLEDGE_NOTE_LIMIT, KNOWLEDGE_TEXT_LIMIT, KNOWLEDGE_TITLE_LIMIT,
  htmlTitle, htmlToText, knowledgeMeta, knowledgeTitle, normalizeKnowledgeText, parseKnowledgeLibrary,
  type KnowledgeMeta, type KnowledgeSource,
} from '../shared/knowledge.js';

const LIBRARY_BYTES = 16 * 1024 * 1024;
const FILE_BYTES = 4 * 1024 * 1024;
const FETCH_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT = 15_000;

interface KnowledgeDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

function safeFileName(value: string): string {
  const base = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[:*?"<>|]/g, '-').replace(/^\.+/, '').trim();
  return (base || 'source').slice(0, 120);
}

/** Looks binary if a NUL byte appears early; PDFs and images land here too. */
function isBinary(bytes: Buffer): boolean {
  const window = bytes.subarray(0, 8000);
  return window.includes(0);
}

export class KnowledgeStore {
  private sources?: KnowledgeSource[];
  private queue: Promise<void> = Promise.resolve();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(readonly directory: string, deps: KnowledgeDeps = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  private get libraryPath(): string { return join(this.directory, KNOWLEDGE_LIBRARY_FILE); }

  private async load(): Promise<KnowledgeSource[]> {
    if (this.sources) return this.sources;
    try {
      const info = await stat(this.libraryPath);
      if (!info.isFile() || info.size > LIBRARY_BYTES) { this.sources = []; return this.sources; }
      this.sources = parseKnowledgeLibrary(await readFile(this.libraryPath, 'utf8'));
    } catch { this.sources = []; }
    return this.sources;
  }

  private async save(): Promise<void> {
    const sources = await this.load();
    const write = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = join(this.directory, `library.${process.pid}.tmp`);
      await writeFile(temporary, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.libraryPath);
    });
    this.queue = write.catch(() => undefined);
    await write;
  }

  async list(): Promise<KnowledgeMeta[]> {
    const sources = await this.load();
    return [...sources].sort((a, b) => b.updatedAt - a.updatedAt).map(knowledgeMeta);
  }

  async read(id: string): Promise<string> {
    const source = (await this.load()).find((item) => item.id === id);
    if (!source) throw new Error('That Knowledge source no longer exists.');
    return source.text;
  }

  /** Adds a pasted note; the first line becomes the title when none was given. */
  async addNote(title: string | undefined, body: string): Promise<void> {
    const text = normalizeKnowledgeText(body);
    if (!text) throw new Error('Write something before saving the note.');
    if (text.length > KNOWLEDGE_NOTE_LIMIT) throw new Error(`Notes are limited to ${KNOWLEDGE_NOTE_LIMIT.toLocaleString('en')} characters.`);
    const firstLine = text.split('\n').find((line) => line.trim())?.slice(0, KNOWLEDGE_TITLE_LIMIT);
    const sources = await this.load();
    const now = this.now();
    sources.push({
      id: randomUUID(), title: knowledgeTitle(title, firstLine || 'Note'), kind: 'note',
      text, createdAt: now, updatedAt: now,
    });
    await this.save();
  }

  /** Copies text files into the library and saves their readable text; binary files are refused. */
  async addFiles(paths: string[]): Promise<{ added: number; skipped: string[] }> {
    const skipped: string[] = [];
    let added = 0;
    for (const path of paths) {
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error('Folders cannot be added. Choose files instead.');
        if (info.size > FILE_BYTES) throw new Error(`“${safeFileName(path)}” is larger than 4 MB.`);
        const bytes = await readFile(path);
        if (!bytes.length) throw new Error(`“${safeFileName(path)}” is empty.`);
        if (isBinary(bytes)) throw new Error(`“${safeFileName(path)}” is a binary file (PDF, image or archive). Paste its text as a note instead.`);
        const text = normalizeKnowledgeText(bytes.toString('utf8')).slice(0, KNOWLEDGE_TEXT_LIMIT);
        if (!text) throw new Error(`“${safeFileName(path)}” has no readable text.`);
        const sources = await this.load();
        const now = this.now();
        const origin = path;
        const existing = sources.find((item) => item.origin === origin);
        const name = safeFileName(path);
        const title = knowledgeTitle(name.replace(/\.[^.]+$/, ''), name);
        if (existing) {
          existing.title = title;
          existing.text = text;
          existing.updatedAt = now;
        } else {
          const id = randomUUID();
          await mkdir(join(this.directory, 'files'), { recursive: true, mode: 0o700 });
          await writeFile(join(this.directory, 'files', `${id}-${name}`), bytes, { mode: 0o600 });
          sources.push({ id, title, kind: 'file', origin, text, createdAt: now, updatedAt: now });
        }
        added++;
      } catch (error) {
        skipped.push(`${safeFileName(path)}: ${error instanceof Error ? error.message : 'could not be read.'}`);
      }
    }
    if (added) await this.save();
    return { added, skipped };
  }

  /** Fetches a page or text link and saves its readable text; the same URL is refreshed in place. */
  async addLink(url: string): Promise<void> {
    let target: URL;
    try { target = new URL(url); } catch { throw new Error('Enter a full link starting with http:// or https://.'); }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Only http and https links are supported.');
    const response = await this.fetchImpl(target.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'user-agent': 'Relay Knowledge (local library)' },
    }).catch(() => { throw new Error('That link could not be reached.'); });
    if (!response.ok) throw new Error(`That link answered with HTTP ${response.status}.`);
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    const readable = !type || /text\/|application\/(json|xml|xhtml)/.test(type);
    if (!readable) throw new Error('That link is not a page or text file; only readable pages can be saved.');
    const raw = (await response.text()).slice(0, FETCH_BYTES);
    const html = /html|xml/.test(type) || /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
    const text = (html ? htmlToText(raw) : normalizeKnowledgeText(raw)).slice(0, KNOWLEDGE_TEXT_LIMIT);
    if (!text) throw new Error('That link had no readable text.');
    const title = knowledgeTitle(html ? htmlTitle(raw) : undefined, target.hostname + (target.pathname === '/' ? '' : target.pathname));
    const sources = await this.load();
    const now = this.now();
    const origin = target.href;
    const existing = sources.find((item) => item.origin === origin);
    if (existing) {
      existing.title = title;
      existing.text = text;
      existing.updatedAt = now;
    } else {
      sources.push({ id: randomUUID(), title, kind: 'link', origin, text, createdAt: now, updatedAt: now });
    }
    await this.save();
  }

  async remove(id: string): Promise<void> {
    const sources = await this.load();
    const index = sources.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('That Knowledge source no longer exists.');
    const [removed] = sources.splice(index, 1);
    await this.save();
    if (removed.kind === 'file') {
      try {
        const files = join(this.directory, 'files');
        const name = (await readdir(files)).find((file) => file.startsWith(`${removed.id}-`));
        if (name) await rm(join(files, name), { force: true });
      } catch { /* the copy is optional; the library is the source of truth */ }
    }
  }

  /** Test hook: drops the in-memory cache so the next call reads the library from disk. */
  forget(): void { this.sources = undefined; }
}
