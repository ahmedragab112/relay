import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  ATLAS_CARDS_FILE, ATLAS_PLAN_FILE, ATLAS_ROOT, atlasPrompt, normalizeAtlasPages, parseAtlasCards, parseAtlasPlan,
  type AtlasCard, type AtlasCards, type AtlasLanguage, type AtlasManifest, type AtlasPage, type AtlasStatus, type AtlasView,
} from '../shared/atlas.js';
import type { AutoSettings, SendMessageInput } from '../shared/contracts.js';

const run = promisify(execFile);
const PLAN_BYTES = 2 * 1024 * 1024;
const PAGE_BYTES = 1024 * 1024;

export interface AtlasProject {
  id: string;
  name: string;
  path: string;
}

export interface AtlasEngine {
  createSession(title: string, directory: string): Promise<{ id: string }>;
  sendMessage(input: SendMessageInput): Promise<void>;
  waitForIdle(sessionId: string): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
}

export interface AtlasDeps {
  project(): AtlasProject | undefined;
  engine(): AtlasEngine;
  model(): { model: string; auto: boolean; autoSettings?: AutoSettings };
  emit(projectId: string, view: AtlasView): void;
  sessionsChanged(): void;
}

function atlasDir(project: AtlasProject, language: AtlasLanguage): string {
  return join(project.path, ATLAS_ROOT, language);
}

async function gitHead(root: string): Promise<string | undefined> {
  try {
    const result = await run('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 4000 });
    return result.stdout.trim() || undefined;
  } catch { return undefined; }
}

/** Files changed between a manifest baseline and HEAD; empty when git cannot answer. */
async function gitChanged(root: string, baseline?: string): Promise<string[]> {
  if (!baseline) return [];
  try {
    const result = await run('git', ['diff', '--name-only', baseline, 'HEAD'], { cwd: root, timeout: 6000, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout.split('\n').map((line) => line.trim())
      .filter((line) => line && line !== ATLAS_ROOT && !line.startsWith(`${ATLAS_ROOT}/`))
      .slice(0, 200);
  } catch { return []; }
}

const pageDigest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32);

function readManifest(text: string, language: AtlasLanguage): AtlasManifest | undefined {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return undefined; }
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<AtlasManifest>;
  if (value.version !== 1 || value.language !== language || !Array.isArray(value.pages)) return undefined;
  const pages = normalizeAtlasPages(value.pages.filter((page): page is AtlasPage =>
    Boolean(page) && typeof page === 'object' && typeof (page as AtlasPage).title === 'string' && typeof (page as AtlasPage).slug === 'string'));
  if (!pages.length) return undefined;
  return {
    version: 1, language,
    project: typeof value.project === 'string' ? value.project : '',
    generatedAt: typeof value.generatedAt === 'number' ? value.generatedAt : 0,
    ...(typeof value.baseline === 'string' && value.baseline ? { baseline: value.baseline } : {}),
    pages,
  };
}

interface InternalRun { status: AtlasStatus; sessionId?: string; canceled: boolean; done: boolean }

export class AtlasRunner {
  private runs = new Map<string, InternalRun>();

  constructor(private deps: AtlasDeps) {}

  private key(project: AtlasProject, language: AtlasLanguage): string {
    return `${project.path}\u0000${language}`;
  }

  status(project: AtlasProject, language: AtlasLanguage): AtlasStatus {
    return this.runs.get(this.key(project, language))?.status ?? { state: 'idle' };
  }

  private active(project: AtlasProject, language: AtlasLanguage): boolean {
    const state = this.status(project, language).state;
    return state === 'planning' || state === 'writing';
  }

  private async readPlan(project: AtlasProject) {
    try {
      const path = join(project.path, ATLAS_ROOT, ATLAS_PLAN_FILE);
      const info = await stat(path);
      if (!info.isFile() || info.size > PLAN_BYTES) return { present: false, warnings: ['The plan file is larger than 2 MB and was skipped.'], plan: parseAtlasPlan('').plan };
      return { present: true, ...parseAtlasPlan(await readFile(path, 'utf8')) };
    } catch {
      return { present: false, warnings: [], plan: parseAtlasPlan('').plan };
    }
  }

  private async readManifestFile(project: AtlasProject, language: AtlasLanguage): Promise<AtlasManifest | undefined> {
    try { return readManifest(await readFile(join(atlasDir(project, language), 'manifest.json'), 'utf8'), language); }
    catch { return undefined; }
  }

  private async pageHash(project: AtlasProject, language: AtlasLanguage, slug: string): Promise<string | undefined> {
    try {
      return pageDigest(await readFile(join(atlasDir(project, language), `${slug}.md`), 'utf8'));
    } catch { return undefined; }
  }

  /** Adds the runtime-only `edited` flag; hashing is skipped while the agent is writing. */
  private async decorate(project: AtlasProject, language: AtlasLanguage, manifest: AtlasManifest | undefined, busy: boolean): Promise<AtlasManifest | undefined> {
    if (!manifest || busy) return manifest;
    const pages = await Promise.all(manifest.pages.map(async (page) => {
      if (!page.hash) return page;
      const hash = await this.pageHash(project, language, page.slug);
      return { ...page, edited: Boolean(hash && hash !== page.hash) };
    }));
    return { ...manifest, pages };
  }

  private async writeManifest(project: AtlasProject, language: AtlasLanguage, manifest: AtlasManifest): Promise<void> {
    const dir = atlasDir(project, language);
    const pages = manifest.pages.map((page) => ({
      slug: page.slug, title: page.title,
      ...(page.parent ? { parent: page.parent } : {}),
      ...(page.summary ? { summary: page.summary } : {}),
      ...(page.hash ? { hash: page.hash } : {}),
      ...(page.pinned ? { pinned: true } : {}),
    }));
    const temporary = join(dir, `manifest.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify({ ...manifest, pages }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, join(dir, 'manifest.json'));
  }

  private async manifestPage(project: AtlasProject, language: AtlasLanguage, slug: string): Promise<AtlasPage> {
    const normalized = normalizeAtlasPages([{ slug, title: slug }])[0];
    if (!normalized || normalized.slug !== slug.replace(/\.md$/, '')) throw new Error('That page name is not valid.');
    const manifest = await this.readManifestFile(project, language);
    const page = manifest?.pages.find((item) => item.slug === normalized.slug);
    if (!page) throw new Error('That page is not in Atlas yet.');
    return page;
  }

  private pagePath(project: AtlasProject, language: AtlasLanguage, slug: string): string {
    const folder = resolve(atlasDir(project, language));
    const path = resolve(folder, `${slug}.md`);
    const inside = relative(folder, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('That page is not valid.');
    return path;
  }

  private async readCards(project: AtlasProject, language: AtlasLanguage, manifest: AtlasManifest | undefined, busy: boolean): Promise<AtlasCards> {
    const empty: AtlasCards = { present: false, count: 0, warnings: [] };
    if (!manifest || busy) return empty;
    try {
      const info = await stat(join(atlasDir(project, language), ATLAS_CARDS_FILE));
      if (!info.isFile()) return empty;
      if (info.size > PLAN_BYTES) return { present: false, count: 0, warnings: ['knowledge/cards.json is larger than 2 MB and was skipped.'] };
      const parsed = parseAtlasCards(await readFile(join(atlasDir(project, language), ATLAS_CARDS_FILE), 'utf8'), manifest.pages);
      return { present: true, count: parsed.cards.length, warnings: parsed.warnings };
    } catch { return empty; }
  }

  async cards(language: AtlasLanguage): Promise<AtlasCard[]> {
    const project = this.requireProject();
    const manifest = await this.readManifestFile(project, language);
    if (!manifest) return [];
    try {
      const path = join(atlasDir(project, language), ATLAS_CARDS_FILE);
      const info = await stat(path);
      if (!info.isFile() || info.size > PLAN_BYTES) return [];
      return parseAtlasCards(await readFile(path, 'utf8'), manifest.pages).cards;
    } catch { return []; }
  }

  async view(language: AtlasLanguage): Promise<AtlasView> {
    const project = this.requireProject();
    const plan = await this.readPlan(project);
    const status = this.status(project, language);
    const busy = this.active(project, language);
    const manifest = await this.decorate(project, language, await this.readManifestFile(project, language), busy);
    const current = await gitHead(project.path);
    const generated = manifest?.baseline;
    return {
      language,
      ...(manifest ? { manifest } : {}),
      plan: { present: plan.present, warnings: plan.warnings, documents: plan.plan.documents.length },
      status,
      cards: await this.readCards(project, language, manifest, busy),
      ...(manifest || current ? { baseline: { ...(generated ? { generated } : {}), ...(current ? { current } : {}), stale: Boolean(generated && current && generated !== current) } } : {}),
    };
  }

  async page(language: AtlasLanguage, slug: string): Promise<string> {
    const project = this.requireProject();
    const page = await this.manifestPage(project, language, slug);
    const path = this.pagePath(project, language, page.slug);
    const info = await stat(path);
    if (!info.isFile() || info.size > PAGE_BYTES) throw new Error('That page could not be read.');
    return readFile(path, 'utf8');
  }

  /** Writes hand-written Markdown; the hash stays at the generated value, so the page reads as edited. */
  async savePage(language: AtlasLanguage, slug: string, text: string): Promise<AtlasView> {
    const project = this.requireProject();
    if (this.active(project, language)) throw new Error('Wait for Atlas to finish before editing a page.');
    const page = await this.manifestPage(project, language, slug);
    if (!text.trim()) throw new Error('A page cannot be empty.');
    if (Buffer.byteLength(text, 'utf8') > PAGE_BYTES) throw new Error('That page is too long; keep it under 1 MB.');
    await writeFile(this.pagePath(project, language, page.slug), text, { mode: 0o600 });
    return this.viewOf(project, language, this.status(project, language));
  }

  /** Rebuilds the manifest from the Markdown on disk, adopting pages edited or added outside Relay. */
  async sync(language: AtlasLanguage): Promise<AtlasView> {
    const project = this.requireProject();
    if (this.active(project, language)) throw new Error('Wait for Atlas to finish before syncing.');
    const dir = atlasDir(project, language);
    const previous = await this.readManifestFile(project, language);
    const known = new Map((previous?.pages ?? []).map((page) => [page.slug, page]));
    let files: string[] = [];
    try { files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort(); } catch { files = []; }
    const found = new Map<string, AtlasPage>();
    for (const file of files) {
      const raw = file.slice(0, -3);
      const normalized = normalizeAtlasPages([{ slug: raw, title: raw }])[0];
      if (!normalized || found.has(normalized.slug)) continue;
      const text = await readFile(join(dir, file), 'utf8').catch(() => undefined);
      if (!text || !text.trim()) continue;
      const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const old = known.get(normalized.slug);
      if (old) { found.set(normalized.slug, heading ? { ...old, title: heading.slice(0, 100) } : old); continue; }
      found.set(normalized.slug, {
        slug: normalized.slug,
        title: (heading || normalized.slug).slice(0, 100),
        hash: pageDigest(text),
        pinned: true,
      });
    }
    if (!found.size) throw new Error('No Markdown pages were found to sync.');
    const ordered = normalizeAtlasPages([
      ...(previous?.pages ?? []).filter((page) => found.has(page.slug)),
      ...[...found.values()].filter((page) => !known.has(page.slug)),
    ]);
    const baseline = previous?.baseline ?? await gitHead(project.path);
    await this.writeManifest(project, language, {
      version: 1, language, project: project.name,
      generatedAt: previous?.generatedAt ?? Date.now(),
      ...(baseline ? { baseline } : {}),
      pages: ordered,
    });
    this.deps.sessionsChanged();
    const detail = `${ordered.length} ${ordered.length === 1 ? 'page' : 'pages'} after sync`;
    return this.viewOf(project, language, { state: 'ready', detail });
  }

  async cancel(): Promise<void> {
    const project = this.requireProject();
    for (const [key, run] of [...this.runs.entries()]) {
      if (!key.startsWith(`${project.path}\u0000`) || run.done || (run.status.state !== 'planning' && run.status.state !== 'writing')) continue;
      run.canceled = true;
      if (run.sessionId) await this.deps.engine().abortSession(run.sessionId).catch(() => undefined);
      await this.publish(project, key.split('\u0000')[1] as AtlasLanguage, { state: 'canceled' });
    }
  }

  private requireProject(): AtlasProject {
    const project = this.deps.project();
    if (!project) throw new Error('Open a project folder first. Atlas needs code to read.');
    return project;
  }

  private async snapshotPages(project: AtlasProject, language: AtlasLanguage): Promise<Map<string, { hash: string; text: string }>> {
    const dir = atlasDir(project, language);
    const result = new Map<string, { hash: string; text: string }>();
    let files: string[] = [];
    try { files = (await readdir(dir)).filter((file) => file.endsWith('.md')); } catch { return result; }
    for (const file of files) {
      const text = await readFile(join(dir, file), 'utf8').catch(() => undefined);
      if (!text || !text.trim() || Buffer.byteLength(text, 'utf8') > PAGE_BYTES) continue;
      result.set(file.slice(0, -3), { hash: pageDigest(text), text });
    }
    return result;
  }

  async generate(language: AtlasLanguage): Promise<AtlasView> {
    const project = this.requireProject();
    const key = this.key(project, language);
    if (this.active(project, language)) throw new Error('Atlas is already being written for this language.');
    const run: InternalRun = { status: { state: 'planning' }, canceled: false, done: false };
    this.runs.set(key, run);
    const dir = atlasDir(project, language);
    let timer: NodeJS.Timeout | undefined;
    try {
      const engine = this.deps.engine();
      const before = await this.readManifestFile(project, language);
      const plan = await this.readPlan(project);
      await mkdir(dir, { recursive: true });
      await rm(join(dir, 'plan.json'), { force: true });
      const session = await engine.createSession(`Atlas · ${project.name}`, project.path);
      run.sessionId = session.id;
      const snapshot = await this.snapshotPages(project, language);
      // Pages a person owns (hand-added or edited since generation) are restored after the run.
      const protect = (before?.pages ?? []).filter((page) => {
        const held = snapshot.get(page.slug);
        return Boolean(page.pinned || (page.hash && held && held.hash !== page.hash));
      });
      const changed = await gitChanged(project.path, before?.baseline);
      const total = plan.plan.documents.length || before?.pages.length || 0;
      await this.publish(project, language, { state: 'planning', detail: 'Reading the project' });
      const choice = this.deps.model();
      const prompt = atlasPrompt({ projectName: project.name, language, plan: plan.plan, existing: before?.pages, protect, changed });
      timer = setInterval(() => { void this.countPages(project, language, run, total); }, 2000);
      await engine.sendMessage({
        sessionId: session.id, text: prompt, model: choice.model, variant: '', access: 'auto',
        files: [], skills: [], ...(choice.auto ? { auto: true, autoSettings: choice.autoSettings } : {}),
      });
      await engine.waitForIdle(session.id);
      run.done = true;
      if (timer) { clearInterval(timer); timer = undefined; }
      if (run.canceled) throw new Error('Atlas generation was canceled.');
      for (const page of protect) {
        const held = snapshot.get(page.slug);
        if (held) await writeFile(this.pagePath(project, language, page.slug), held.text, { mode: 0o600 }).catch(() => undefined);
      }
      const written = await this.collect(project, language, run, total);
      const status = await this.finish(project, language, written.pages, written.kept, written.planned, before, snapshot, changed.length > 0);
      run.status = status;
      return await this.viewOf(project, language, status);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Atlas generation failed.';
      const status: AtlasStatus = run.canceled ? { state: 'canceled' } : { state: 'error', error: message };
      this.runs.set(key, { status, canceled: true, done: true });
      await this.viewOf(project, language, status).catch(() => undefined);
      throw error;
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  private async publish(project: AtlasProject, language: AtlasLanguage, status: AtlasStatus): Promise<void> {
    const current = this.runs.get(this.key(project, language));
    if (current) current.status = status;
    await this.viewOf(project, language, status);
  }

  private async countPages(project: AtlasProject, language: AtlasLanguage, run: InternalRun, total: number): Promise<void> {
    if (run.canceled || run.done) return;
    try {
      const files = await readdir(atlasDir(project, language));
      const writing = files.filter((file) => file.endsWith('.md')).length;
      if (run.canceled || run.done) return;
      await this.publish(project, language, { state: 'writing', writing, ...(total ? { total } : {}) });
    } catch { /* the folder appears with the first page */ }
  }

  private async collect(project: AtlasProject, language: AtlasLanguage, run: InternalRun, total: number): Promise<{ pages: AtlasPage[]; kept: string[]; planned: number }> {
    const dir = atlasDir(project, language);
    let planned: AtlasPage[] = [];
    try {
      const raw = JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8')) as { pages?: unknown };
      if (Array.isArray(raw.pages)) {
        planned = normalizeAtlasPages(raw.pages.filter((page): page is AtlasPage =>
          Boolean(page) && typeof page === 'object' && typeof (page as AtlasPage).title === 'string'));
      }
    } catch { planned = []; }
    if (!planned.length) {
      const metadata = await this.currentManifestPages(project, language);
      planned = metadata;
    }
    if (!planned.length) throw new Error('Atlas finished without a page plan. Run it again.');
    const pages: AtlasPage[] = [];
    const kept: string[] = [];
    for (const page of planned) {
      try {
        const info = await stat(join(dir, `${page.slug}.md`));
        if (info.isFile() && info.size > 0) { pages.push(page); kept.push(`${page.slug}.md`); }
      } catch { /* the agent skipped this page */ }
    }
    if (!pages.length) throw new Error(`Atlas finished without writing any page (0 of ${planned.length}). Run it again.`);
    await this.publish(project, language, { state: 'writing', writing: pages.length, total: total || planned.length });
    if (run.canceled) throw new Error('Atlas generation was canceled.');
    return { pages, kept, planned: planned.length };
  }

  private async currentManifestPages(project: AtlasProject, language: AtlasLanguage): Promise<AtlasPage[]> {
    return (await this.readManifestFile(project, language))?.pages ?? [];
  }

  private async finish(project: AtlasProject, language: AtlasLanguage, pages: AtlasPage[], kept: string[], planned: number, before?: AtlasManifest, snapshot?: Map<string, { hash: string; text: string }>, incremental = false): Promise<AtlasStatus> {
    const dir = atlasDir(project, language);
    const previous = new Map((before?.pages ?? []).map((page) => [page.slug, page]));
    const keep = new Set(kept);
    const seen = new Set<string>();
    const result: AtlasPage[] = [];
    for (const page of pages) {
      if (seen.has(page.slug)) continue;
      const old = previous.get(page.slug);
      const now = await this.pageHash(project, language, page.slug);
      if (!now) continue;
      const held = snapshot?.get(page.slug);
      // Content the run never touched keeps its recorded hash, so hand edits stay flagged.
      const hash = old?.hash && held && held.hash === now ? old.hash : now;
      seen.add(page.slug);
      keep.add(`${page.slug}.md`);
      result.push({
        ...page,
        ...(old?.pinned ? { pinned: true } : {}),
        ...(old?.summary && !page.summary ? { summary: old.summary } : {}),
        hash,
      });
    }
    // User-owned pages survive even when the new plan dropped them; an incremental
    // update also keeps pages whose Markdown the run never touched.
    for (const old of before?.pages ?? []) {
      if (seen.has(old.slug)) continue;
      const info = await stat(join(dir, `${old.slug}.md`)).catch(() => undefined);
      if (!info?.isFile() || !info.size) continue;
      const held = snapshot?.get(old.slug);
      const owned = Boolean(old.pinned || (old.hash && held && held.hash !== old.hash));
      const untouched = incremental && Boolean(held && held.hash === await this.pageHash(project, language, old.slug));
      if (!owned && !untouched) continue;
      seen.add(old.slug);
      keep.add(`${old.slug}.md`);
      result.push(old);
    }
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.md') || keep.has(file)) continue;
      // Untracked Markdown is left alone; only pages Atlas wrote before are cleaned up.
      if (!previous.has(file.slice(0, -3))) continue;
      await rm(join(dir, file), { force: true }).catch(() => undefined);
    }
    const baseline = await gitHead(project.path);
    const manifest: AtlasManifest = {
      version: 1, language, project: project.name, generatedAt: Date.now(),
      ...(baseline ? { baseline } : {}), pages: normalizeAtlasPages(result),
    };
    await this.writeManifest(project, language, manifest);
    this.deps.sessionsChanged();
    const count = manifest.pages.length;
    const detail = planned > pages.length ? `${pages.length} of ${planned} pages` : `${count} ${count === 1 ? 'page' : 'pages'}`;
    return { state: 'ready', detail };
  }

  private async viewOf(project: AtlasProject, language: AtlasLanguage, status: AtlasStatus): Promise<AtlasView> {
    const busy = status.state === 'planning' || status.state === 'writing';
    const manifest = await this.decorate(project, language, await this.readManifestFile(project, language), busy);
    const plan = await this.readPlan(project);
    const current = await gitHead(project.path);
    const generated = manifest?.baseline;
    const view: AtlasView = {
      language,
      ...(manifest ? { manifest } : {}),
      plan: { present: plan.present, warnings: plan.warnings, documents: plan.plan.documents.length },
      status,
      cards: await this.readCards(project, language, manifest, busy),
      ...(manifest || current ? { baseline: { ...(generated ? { generated } : {}), ...(current ? { current } : {}), stale: Boolean(generated && current && generated !== current) } } : {}),
    };
    this.deps.emit(project.id, view);
    return view;
  }
}
