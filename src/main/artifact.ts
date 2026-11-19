import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { nextVersion } from '../shared/design.js';

export interface ArtifactProject {
  id: string;
  name: string;
  path: string;
}

export interface ArtifactSpec {
  /** Folder under the project that holds every artifact: `.relay/design`. */
  root: string;
  /** Entry file that previews and briefs start from: `index.html`. */
  entry: string;
  /** Folder name that stores versions: `versions`. */
  versions: string;
  /** Folder-name rule shared with the renderer. */
  valid(slug: string): boolean;
  /** Human title derived from a slug. */
  title(slug: string): string;
  /** Folder names to keep out of the agent file list (still served to previews). */
  ignored?: string[];
  maxFiles?: number;
  maxBytes?: number;
  maxVersions?: number;
}

export interface ArtifactEntry {
  slug: string;
  title: string;
  updatedAt: number;
  versions: number;
  sessionId?: string;
  model?: string;
}

export interface ArtifactVersion {
  version: number;
  savedAt: number;
}

export interface ArtifactFile {
  target: string;
  type: string;
  text: boolean;
}

const SESSION_FILE = 'session.json';
const VERSION_FILE = 'version.json';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
};

/** Shared file, version and session mechanics for Design and Motion artifacts. */
export class ArtifactFolders {
  constructor(private readonly spec: ArtifactSpec) {}

  root(project: ArtifactProject): string {
    return join(project.path, this.spec.root);
  }

  dir(project: ArtifactProject, slug: string): string {
    if (!this.spec.valid(slug)) throw new Error('That artifact folder is not valid.');
    return join(this.root(project), slug);
  }

  /** Folders that hold an artifact, newest first is left to the caller. */
  async slugs(project: ArtifactProject): Promise<string[]> {
    let folders: Dirent[];
    try { folders = await readdir(this.root(project), { withFileTypes: true }); } catch { return []; }
    return folders
      .filter((folder) => folder.isDirectory() && this.spec.valid(folder.name) && folder.name !== this.spec.versions)
      .map((folder) => folder.name);
  }

  /** Files the agent can see, relative to an artifact folder, entry first. */
  async files(project: ArtifactProject, slug: string): Promise<string[]> {
    const dir = this.dir(project, slug);
    const maxFiles = this.spec.maxFiles ?? 200;
    const files: string[] = [];
    const walk = async (folder: string, prefix: string): Promise<void> => {
      let entries;
      try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        if (entry.name.startsWith('.') || entry.name === this.spec.versions) continue;
        if (this.spec.ignored?.includes(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(folder, entry.name), rel);
        else if (entry.isFile()) files.push(rel);
      }
    };
    await walk(dir, '');
    return files.sort((a, b) => (a === this.spec.entry ? -1 : b === this.spec.entry ? 1 : a.localeCompare(b)));
  }

  async entry(project: ArtifactProject, slug: string): Promise<ArtifactEntry | undefined> {
    const dir = this.dir(project, slug);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return undefined; }
    let updatedAt = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === SESSION_FILE) continue;
      const info = await stat(join(dir, entry.name)).catch(() => undefined);
      if (info) updatedAt = Math.max(updatedAt, info.mtimeMs);
    }
    const versions = await this.versionNumbers(project, slug);
    const session = await this.session(project, slug);
    const sessionId = typeof session?.sessionId === 'string' && session.sessionId ? session.sessionId : undefined;
    const model = typeof session?.model === 'string' && session.model ? session.model : undefined;
    return {
      slug, title: this.spec.title(slug), updatedAt: Math.round(updatedAt), versions: versions.length,
      ...(sessionId ? { sessionId } : {}), ...(model ? { model } : {}),
    };
  }

  async session(project: ArtifactProject, slug: string): Promise<Record<string, unknown> | undefined> {
    return readJson(join(this.dir(project, slug), SESSION_FILE));
  }

  async saveSession(project: ArtifactProject, slug: string, patch: Record<string, unknown>): Promise<void> {
    const saved = (await this.session(project, slug)) ?? {};
    await writeJson(join(this.dir(project, slug), SESSION_FILE), { ...saved, ...patch });
  }

  async versionNumbers(project: ArtifactProject, slug: string): Promise<number[]> {
    const dir = join(this.dir(project, slug), this.spec.versions);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && /^[1-9][0-9]{0,5}$/.test(entry.name))
        .map((entry) => Number(entry.name))
        .filter((value) => Number.isSafeInteger(value))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /** Copies the current files into versions/<n>; keeps the newest maxVersions. */
  async snapshot(project: ArtifactProject, slug: string, note?: string): Promise<number> {
    const dir = this.dir(project, slug);
    const numbers = await this.versionNumbers(project, slug);
    const version = nextVersion(numbers);
    const target = join(dir, this.spec.versions, String(version));
    await mkdir(target, { recursive: true });
    const maxBytes = this.spec.maxBytes ?? 4 * 1024 * 1024;
    for (const file of await this.files(project, slug)) {
      const info = await stat(join(dir, file)).catch(() => undefined);
      if (!info?.isFile() || info.size > maxBytes) continue;
      const destination = join(target, file);
      await mkdir(resolve(destination, '..'), { recursive: true });
      if (!isInside(target, resolve(destination))) continue;
      await copyFile(join(dir, file), destination);
    }
    await writeJson(join(target, VERSION_FILE), { savedAt: Date.now(), ...(note ? { note } : {}) });
    while (numbers.length >= (this.spec.maxVersions ?? 20)) {
      const oldest = numbers.shift();
      if (oldest === undefined) break;
      await rm(join(dir, this.spec.versions, String(oldest)), { recursive: true, force: true });
    }
    return version;
  }

  async versions(project: ArtifactProject, slug: string): Promise<ArtifactVersion[]> {
    const numbers = await this.versionNumbers(project, slug);
    const result: ArtifactVersion[] = [];
    for (const version of numbers) {
      const info = await readJson(join(this.dir(project, slug), this.spec.versions, String(version), VERSION_FILE));
      result.push({ version, savedAt: typeof info?.savedAt === 'number' ? info.savedAt : 0 });
    }
    return result.reverse();
  }

  async restore(project: ArtifactProject, slug: string, version: number): Promise<void> {
    const dir = await this.require(project, slug);
    const numbers = await this.versionNumbers(project, slug);
    if (!numbers.includes(version)) throw new Error('That version does not exist.');
    const source = join(dir, this.spec.versions, String(version));
    const kept = new Set<string>();
    const walk = async (folder: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name === VERSION_FILE) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walk(join(folder, entry.name), rel); continue; }
        kept.add(rel);
        const target = resolve(dir, rel);
        if (!isInside(dir, target)) continue;
        await mkdir(resolve(target, '..'), { recursive: true });
        await copyFile(join(folder, entry.name), target);
      }
    };
    await walk(source, '');
    for (const file of await this.files(project, slug)) {
      if (kept.has(file)) continue;
      const target = resolve(dir, file);
      if (isInside(dir, target)) await rm(target, { force: true });
    }
  }

  /** Folder path for an artifact; throws when it is gone or the slug is invalid. */
  async require(project: ArtifactProject, slug: string): Promise<string> {
    const dir = this.dir(project, slug);
    const info = await stat(dir).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error('That artifact no longer exists.');
    return dir;
  }

  /** One file for the preview protocol, contained inside the artifact folder. */
  async file(project: ArtifactProject, rawSlug: string, path: string): Promise<ArtifactFile | undefined> {
    if (!this.spec.valid(rawSlug)) return undefined;
    const dir = join(this.root(project), rawSlug);
    let decoded: string;
    try { decoded = decodeURIComponent(path || this.spec.entry); } catch { return undefined; }
    const target = resolve(dir, decoded);
    if (!isInside(dir, target)) return undefined;
    const info = await stat(target).catch(() => undefined);
    if (!info?.isFile() || info.size > 4 * 1024 * 1024) return undefined;
    const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    const text = type.startsWith('text/') || type === 'image/svg+xml' || type === 'application/json; charset=utf-8';
    return { target, type, text };
  }
}

export async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
