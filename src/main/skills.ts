import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { unzip, type Unzipped } from 'fflate';
import type { SkillLibraryEntry, SkillPreview, SkillPreviewItem } from '../shared/contracts.js';
import { downloadPluginPackage, validateDigest } from './import.js';

const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SKILLS = 20;
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 600;
const MAX_PATH_LENGTH = 240;
const MAX_DEPTH = 8;
const SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const METADATA = 'relay-skill.json';

export interface ParsedSkill {
  name: string;
  description: string;
}

export interface StagedSkill {
  id: string;
  name: string;
  description: string;
  files: Map<string, Uint8Array>;
}

interface StagedInstall {
  directory: string;
  source: string;
  digest: string;
  skills: StagedSkill[];
}

interface SkillMeta {
  source?: string;
  digest?: string;
  installedAt?: number;
}

function junk(path: string): boolean {
  return path.startsWith('__MACOSX/') || basename(path) === '.DS_Store' || basename(path) === 'Thumbs.db';
}

function unsafePath(path: string): string | undefined {
  if (!path || path.includes('\0') || path.includes('\\') || path.length > MAX_PATH_LENGTH) return 'The package contains an unsafe file path.';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'The package contains an absolute file path.';
  const parts = path.split('/');
  if (parts.length > MAX_DEPTH) return 'The package nests files too deeply.';
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return 'The package contains an unsafe file path.';
    if (part.startsWith('.')) return 'The package contains a hidden file path.';
  }
  return undefined;
}

export function parseSkillFile(text: string): ParsedSkill {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!frontmatter) throw new Error('SKILL.md needs a frontmatter block with a name and description.');
  const values = new Map<string, string>();
  for (const line of frontmatter[1].split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match || values.has(match[1].toLowerCase())) continue;
    const value = match[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    values.set(match[1].toLowerCase(), value);
  }
  const name = values.get('name') ?? '';
  if (!name) throw new Error('SKILL.md needs a name in its frontmatter.');
  if (name.length > MAX_NAME) throw new Error(`A skill name must be ${MAX_NAME} characters or fewer.`);
  const description = values.get('description') ?? '';
  if (description.length > MAX_DESCRIPTION) throw new Error(`A skill description must be ${MAX_DESCRIPTION} characters or fewer.`);
  return { name, description };
}

export function skillIdFromName(name: string): string {
  const id = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
  if (!SKILL_ID.test(id)) throw new Error(`“${name}” does not contain a usable skill name.`);
  return id;
}

function checkedId(value: string): string {
  if (!SKILL_ID.test(value) || value === '.staging') throw new Error('Unknown skill.');
  return value;
}

export function validateSkillURL(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a skill URL.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new Error('Skill downloads must use HTTPS.');
  if (url.username || url.password) throw new Error('Remove credentials from the skill URL.');
  if (!url.hostname) throw new Error('Enter a valid HTTPS URL.');
  return url.toString();
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  let issue = '';
  let count = 0;
  let total = 0;
  const filter = (file: { name: string; originalSize: number }): boolean => {
    if (issue || junk(file.name) || file.name.endsWith('/')) return false;
    const problem = unsafePath(file.name);
    if (problem) { issue = problem; return false; }
    if (++count > MAX_FILES) { issue = `A skill package may contain at most ${MAX_FILES} files.`; return false; }
    if (file.originalSize > MAX_FILE_BYTES) { issue = `A skill file is larger than 2 MB: ${file.name}`; return false; }
    total += file.originalSize;
    if (total > MAX_TOTAL_BYTES) { issue = 'A skill package may expand to at most 20 MB.'; return false; }
    return true;
  };
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter }, (error, files: Unzipped) => {
      if (error) reject(new Error(`This ZIP could not be opened: ${error.message}`));
      else if (issue) reject(new Error(issue));
      else resolve(new Map(Object.entries(files)));
    });
  });
}

function stripSingleRoot(files: Map<string, Uint8Array>): Map<string, Uint8Array> | undefined {
  const roots = new Set([...files.keys()].map((path) => path.split('/')[0]));
  if (roots.size !== 1) return undefined;
  const [root] = [...roots];
  if (![...files.keys()].every((path) => path.startsWith(`${root}/`))) return undefined;
  const stripped = new Map<string, Uint8Array>();
  for (const [path, data] of files) stripped.set(path.slice(root.length + 1), data);
  return stripped;
}

function locateSkills(files: Map<string, Uint8Array>, allowStrip = true): Map<string, Uint8Array>[] {
  if (files.has('SKILL.md')) return [files];
  const groups = new Map<string, Map<string, Uint8Array>>();
  const collect = (root: string): void => {
    const group = new Map<string, Uint8Array>();
    const prefix = root ? `${root}/` : '';
    for (const [path, data] of files) {
      if (!path.startsWith(prefix)) continue;
      if (!root) { group.set(path, data); continue; }
      if (path === `${root}/SKILL.md`) group.set('SKILL.md', data);
      else if (path.startsWith(`${root}/`)) group.set(path.slice(prefix.length), data);
    }
    groups.set(root, group);
  };
  for (const path of files.keys()) {
    const nested = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (nested) collect(`skills/${nested[1]}`);
  }
  if (!groups.size) {
    for (const path of files.keys()) {
      const flat = /^([^/]+)\/SKILL\.md$/.exec(path);
      if (flat) collect(flat[1]);
    }
  }
  if (groups.size) return [...groups.values()];
  if (allowStrip) {
    const stripped = stripSingleRoot(files);
    if (stripped) return locateSkills(stripped, false);
  }
  throw new Error('The package needs a SKILL.md file.');
}

export function analyzeSkillFiles(files: Map<string, Uint8Array>): StagedSkill[] {
  if (!files.size) throw new Error('This package does not contain any files.');
  let count = 0;
  let total = 0;
  for (const [path, data] of files) {
    if (junk(path)) continue;
    const problem = unsafePath(path);
    if (problem) throw new Error(problem);
    if (++count > MAX_FILES) throw new Error(`A skill package may contain at most ${MAX_FILES} files.`);
    if (data.length > MAX_FILE_BYTES) throw new Error(`A skill file is larger than 2 MB: ${path}`);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('A skill package may expand to at most 20 MB.');
  }
  const groups = locateSkills(files);
  if (groups.length > MAX_SKILLS) throw new Error(`A package may contain at most ${MAX_SKILLS} skills.`);
  const seen = new Set<string>();
  return groups.map((group) => {
    const content = group.get('SKILL.md');
    if (!content) throw new Error('The package needs a SKILL.md file.');
    if (content.length > MAX_SKILL_BYTES) throw new Error('SKILL.md is larger than 256 KB.');
    const parsed = parseSkillFile(new TextDecoder().decode(content));
    const id = skillIdFromName(parsed.name);
    if (seen.has(id)) throw new Error(`Two skills in this package use the same name: ${parsed.name}`);
    seen.add(id);
    return { id, ...parsed, files: group };
  });
}

function contentDigest(skills: StagedSkill[]): string {
  const hash = createHash('sha256');
  const entries: Array<[string, Uint8Array]> = [];
  for (const skill of skills) for (const [path, data] of skill.files) entries.push([`${skill.id}/${path}`, data]);
  for (const [path, data] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path); hash.update('\0'); hash.update(String(data.length)); hash.update('\0'); hash.update(data);
  }
  return hash.digest('hex');
}

async function inside(directory: string): Promise<boolean> {
  try { return (await stat(directory)).isDirectory(); }
  catch { return false; }
}

export class SkillLibrary {
  private staged = new Map<string, StagedInstall>();
  constructor(private readonly root: string) {}

  async cleanup(): Promise<void> {
    this.staged.clear();
    await rm(join(this.root, '.staging'), { recursive: true, force: true });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async list(): Promise<SkillLibraryEntry[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const skills: SkillLibraryEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SKILL_ID.test(entry.name)) continue;
      const directory = join(this.root, entry.name);
      let parsed: ParsedSkill;
      try { parsed = parseSkillFile(await readFile(join(directory, 'SKILL.md'), 'utf8')); }
      catch { continue; }
      const meta = await readFile(join(directory, METADATA), 'utf8').then((text) => JSON.parse(text) as SkillMeta).catch(() => ({} as SkillMeta));
      let files = 0;
      let bytes = 0;
      for (const item of await readdir(directory, { recursive: true, withFileTypes: true })) {
        if (!item.isFile()) continue;
        files++;
        bytes += (await stat(join(item.parentPath, item.name)).catch(() => ({ size: 0 }))).size;
      }
      const installedAt = Number.isFinite(meta.installedAt) ? meta.installedAt! : (await stat(directory).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      skills.push({
        id: entry.name, name: parsed.name, description: parsed.description,
        source: typeof meta.source === 'string' ? meta.source : '',
        digest: typeof meta.digest === 'string' ? meta.digest : '',
        installedAt, files, bytes,
      });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async previewFiles(files: Map<string, Uint8Array>, source: string, digest?: string): Promise<SkillPreview> {
    const skills = analyzeSkillFiles(files);
    const token = randomUUID();
    const directory = join(this.root, '.staging', token);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const items: SkillPreviewItem[] = [];
    const listing: SkillPreview['files'] = [];
    try {
      for (const skill of skills) {
        const folder = join(directory, skill.id);
        for (const [path, data] of skill.files) {
          const target = join(folder, ...path.split('/'));
          await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
          await writeFile(target, data, { mode: 0o600 });
          listing.push({ path: `${skill.id}/${path}`, size: data.length });
        }
        items.push({ id: skill.id, name: skill.name, description: skill.description, existing: await inside(join(this.root, skill.id)) });
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    const preview: SkillPreview = {
      token, digest: digest ?? contentDigest(skills), source: source.slice(0, 500),
      skills: items, files: listing.sort((a, b) => a.path.localeCompare(b.path)),
    };
    this.staged.set(token, { directory, source: preview.source, digest: preview.digest, skills });
    return preview;
  }

  async previewURL(value: unknown, sha256: unknown, options: { fetch?: (input: string, init: RequestInit) => Promise<Response> } = {}): Promise<SkillPreview> {
    const url = validateSkillURL(value);
    const expected = validateDigest(sha256);
    const download = await downloadPluginPackage(url, expected, { fetch: options.fetch, subject: 'skill' });
    try {
      const bytes = new Uint8Array(await readFile(download.path));
      const files = isZip(bytes)
        ? await readZip(bytes)
        : new Map<string, Uint8Array>([['SKILL.md', bytes]]);
      return await this.previewFiles(files, url, download.digest);
    } finally {
      await rm(download.directory, { recursive: true, force: true });
    }
  }

  async install(token: string): Promise<SkillLibraryEntry[]> {
    const entry = this.staged.get(token);
    if (!entry) throw new Error('This skill preview has expired. Download it again.');
    this.staged.delete(token);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      for (const skill of entry.skills) {
        const target = join(this.root, skill.id);
        const count = [...skill.files.keys()].length;
        let bytes = 0;
        for (const data of skill.files.values()) bytes += data.length;
        await rm(target, { recursive: true, force: true });
        await rename(join(entry.directory, skill.id), target);
        const meta: Required<SkillMeta> = { source: entry.source, digest: entry.digest, installedAt: Date.now() };
        await writeFile(join(target, METADATA), JSON.stringify({ ...meta, files: count, bytes }), { mode: 0o600 });
      }
    } finally {
      await rm(entry.directory, { recursive: true, force: true });
    }
    return this.list();
  }

  async cancel(token: string): Promise<void> {
    const entry = this.staged.get(token);
    this.staged.delete(token);
    if (entry) await rm(entry.directory, { recursive: true, force: true });
  }

  async remove(value: string): Promise<SkillLibraryEntry[]> {
    const id = checkedId(value);
    await rm(join(this.root, id), { recursive: true, force: true });
    return this.list();
  }
}
