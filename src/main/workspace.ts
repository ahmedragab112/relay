import { constants } from 'node:fs';
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileDocument, FileEntry, FileSearchResult, SearchMode } from '../shared/contracts.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const SEARCH_LIMIT = 80;
const SEARCH_SCAN_LIMIT = 4000;
const SEARCH_TIME_BUDGET = 6000;
const hiddenDirectories = new Set(['.git', 'node_modules', '.DS_Store', '.next', '.venv', 'dist', 'release', 'build', 'target', 'vendor', '__pycache__']);
const revision = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');

export class WorkspaceFiles {
  constructor(readonly root: string) {}

  async resolvePath(input: string): Promise<string> {
    if (typeof input !== 'string' || input.includes('\0') || isAbsolute(input)) {
      throw new Error('Use a relative path inside the workspace.');
    }
    const root = await realpath(this.root);
    const candidate = resolve(root, input);
    this.assertInside(root, candidate);
    const target = await realpath(candidate);
    this.assertInside(root, target);
    return target;
  }

  private assertInside(root: string, target: string): void {
    const path = relative(root, target);
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error('The file is outside the selected workspace.');
    }
  }

  async list(path = ''): Promise<FileEntry[]> {
    const directory = await this.resolvePath(path);
    const items = await readdir(directory, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const item of items) {
      if (hiddenDirectories.has(item.name)) continue;
      const entryPath = join(path, item.name);
      if (item.isSymbolicLink()) {
        try {
          const target = await this.resolvePath(entryPath);
          const info = await stat(target);
          if (info.isDirectory() || info.isFile()) result.push({ path: entryPath, name: item.name, directory: info.isDirectory() });
        } catch {
          continue;
        }
      } else if (item.isDirectory() || item.isFile()) {
        result.push({ path: entryPath, name: item.name, directory: item.isDirectory() });
      }
    }
    if (result.length > 3000) throw new Error('This folder has more than 3,000 entries. Open a smaller project folder.');
    return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }

  async search(query: string, mode: SearchMode): Promise<FileSearchResult[]> {
    const needle = query.trim();
    if (!needle) return [];
    const lower = needle.toLowerCase();
    const root = await realpath(this.root);
    const results: FileSearchResult[] = [];
    const pending: string[] = [''];
    const started = Date.now();
    let scanned = 0;
    while (pending.length && results.length < SEARCH_LIMIT && Date.now() - started < SEARCH_TIME_BUDGET) {
      const directory = pending.pop()!;
      let entries;
      try { entries = await readdir(join(root, directory), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (results.length >= SEARCH_LIMIT || Date.now() - started >= SEARCH_TIME_BUDGET) break;
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!hiddenDirectories.has(entry.name) && !entry.name.startsWith('.')) pending.push(path);
          continue;
        }
        if (!entry.isFile()) continue;
        scanned++;
        if (mode === 'files') {
          if (path.toLowerCase().includes(lower)) results.push({ path });
          continue;
        }
        if (scanned > SEARCH_SCAN_LIMIT) break;
        try {
          const info = await stat(join(root, path));
          if (info.size > MAX_SEARCH_FILE_BYTES) continue;
          const data = await readFile(join(root, path));
          if (data.includes(0)) continue;
          const lines = data.toString('utf8').split('\n');
          for (let index = 0; index < lines.length; index++) {
            if (!lines[index].toLowerCase().includes(lower)) continue;
            results.push({ path, line: index + 1, preview: lines[index].trim().slice(0, 180) });
            if (results.length >= SEARCH_LIMIT) break;
          }
        } catch { /* unreadable files are skipped */ }
      }
    }
    return mode === 'files'
      ? results.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))
      : results;
  }

  async read(path: string): Promise<FileDocument> {
    const target = await this.resolvePath(path);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Select a regular text file.');
      if (info.size > MAX_FILE_BYTES) throw new Error('The editor supports text files up to 2 MB.');
      const data = await handle.readFile();
      this.assertText(data);
      return { path, content: data.toString('utf8'), revision: revision(data) };
    } finally {
      await handle.close();
    }
  }

  async save(path: string, content: string, expectedRevision: string): Promise<FileDocument> {
    const data = Buffer.from(content, 'utf8');
    this.assertText(data);
    const target = await this.resolvePath(path);
    const handle = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Select a regular text file.');
      if (info.size > MAX_FILE_BYTES) throw new Error('The editor supports text files up to 2 MB.');
      const current = await handle.readFile();
      if (revision(current) !== expectedRevision) {
        throw new Error('This file changed on disk. Reload it before saving to avoid overwriting other changes.');
      }
      let offset = 0;
      while (offset < data.length) {
        const { bytesWritten } = await handle.write(data, offset, data.length - offset, offset);
        offset += bytesWritten;
      }
      await handle.truncate(data.length);
      await handle.sync();
      return { path, content, revision: revision(data) };
    } finally {
      await handle.close();
    }
  }

  private assertText(data: Buffer): void {
    if (data.length > MAX_FILE_BYTES) throw new Error('The editor supports text files up to 2 MB.');
    if (data.includes(0)) throw new Error('Binary files cannot be opened in the text editor.');
  }
}
