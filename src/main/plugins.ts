import { randomUUID, createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { unzip, type Unzipped } from 'fflate';
import type {
  McpServer, PluginCapabilities, PluginCodePreview, PluginFilePreview, PluginManifest,
  PluginPreview, PluginRecord,
} from '../shared/contracts.js';
import { validateMcp } from './settings.js';

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LENGTH = 240;
const MAX_DEPTH = 8;
const MAX_CODE_PREVIEW_BYTES = 40 * 1024;
const MAX_CODE_PREVIEW_TOTAL = 80 * 1024;
const MAX_MCP_SERVERS = 20;
const MAX_MANIFEST_BYTES = 64 * 1024;
const ROOT_FILES = new Set(['relay-plugin.json', 'README.md', 'LICENSE', 'LICENSE.md', 'mcp.json']);
const ROOT_DIRECTORIES = new Set(['skills', 'commands', 'agents', 'plugins']);
const CODE_FILES = /\.(?:js|mjs|cjs|ts|mts|cts)$/;

interface Staged {
  directory: string;
  digest: string;
  preview: PluginPreview;
  mcp: McpServer[];
}

export interface CatalogPlugin {
  manifest: PluginManifest;
  capabilities: PluginCapabilities;
  digest: string;
  directory: string;
}

function junk(path: string): boolean {
  return path.startsWith('__MACOSX/') || basename(path) === '.DS_Store' || basename(path) === 'Thumbs.db';
}

function unsafe(path: string): string | undefined {
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

function isManifest(value: unknown): PluginManifest {
  const manifest = value as Partial<PluginManifest>;
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(manifest.id)) throw new Error('Use a plugin id with lowercase letters, numbers, dashes, or underscores.');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) throw new Error('The plugin manifest needs a name of 80 characters or fewer.');
  if (typeof manifest.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(manifest.version)) throw new Error('The plugin manifest needs a valid version.');
  if (manifest.description !== undefined && (typeof manifest.description !== 'string' || manifest.description.length > 400)) throw new Error('The plugin description must be 400 characters or fewer.');
  return { id: manifest.id, name: manifest.name.trim(), version: manifest.version, description: manifest.description ?? '' };
}

function parseMcp(text: string): McpServer[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('The plugin mcp.json is not valid JSON.'); }
  const servers = Array.isArray(value) ? value : (value as { servers?: unknown })?.servers;
  if (!Array.isArray(servers) || servers.length > MAX_MCP_SERVERS) throw new Error('The plugin must declare its MCP servers as an array.');
  return servers.map((server) => validateMcp(server as McpServer));
}

async function readArchive(path: string): Promise<Map<string, Uint8Array>> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Choose a plugin ZIP file.');
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error('This plugin ZIP is larger than 20 MB.');
  const buffer = new Uint8Array(await readFile(path));
  let issue = '';
  let count = 0;
  let total = 0;
  const filter = (file: { name: string; originalSize: number }): boolean => {
    if (issue || junk(file.name) || file.name.endsWith('/')) return false;
    try {
      const problem = unsafe(file.name);
      if (problem) { issue = problem; return false; }
      count++;
      if (count > MAX_FILES) { issue = 'The plugin contains more than 500 files.'; return false; }
      if (file.originalSize > MAX_FILE_BYTES) { issue = `The plugin contains a file larger than 10 MB: ${file.name}`; return false; }
      total += file.originalSize;
      if (total > MAX_TOTAL_BYTES) { issue = 'The plugin expands to more than 100 MB.'; return false; }
      return true;
    } catch (error) {
      issue = error instanceof Error ? error.message : 'The plugin package could not be read.';
      return false;
    }
  };
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(buffer, { filter }, (error, files) => error ? reject(new Error(`This ZIP could not be opened: ${error.message}`)) : resolve(files));
  });
  if (issue) throw new Error(issue);
  const map = new Map(Object.entries(entries));
  if (!map.size) throw new Error('This ZIP does not contain any files.');
  if (!map.has('relay-plugin.json')) {
    const roots = new Set([...map.keys()].map((name) => name.split('/')[0]));
    if (roots.size === 1) {
      const [root] = [...roots];
      if ([...map.keys()].every((name) => name.startsWith(`${root}/`))) {
        const stripped = new Map<string, Uint8Array>();
        for (const [name, data] of map) stripped.set(name.slice(root.length + 1), data);
        if (stripped.has('relay-plugin.json')) return stripped;
      }
    }
  }
  return map;
}

async function readDirectory(directory: string): Promise<Map<string, Uint8Array>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of entries) {
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(directory, absolute).split(sep).join('/');
    if (junk(path) || entry.isDirectory()) continue;
    if (!entry.isFile()) throw new Error(`The plugin package contains an unsupported file: ${path}`);
    const problem = unsafe(path);
    if (problem) throw new Error(problem);
    const info = await stat(absolute);
    if (info.size > MAX_FILE_BYTES) throw new Error(`The package contains a file larger than 10 MB: ${path}`);
    if (files.size >= MAX_FILES) throw new Error('The plugin contains more than 500 files.');
    total += info.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('The plugin expands to more than 100 MB.');
    files.set(path, new Uint8Array(await readFile(absolute)));
  }
  if (!files.size) throw new Error('The plugin package is empty.');
  return files;
}

function analyze(files: Map<string, Uint8Array>): { manifest: PluginManifest; capabilities: PluginCapabilities; mcp: McpServer[] } {
  const raw = files.get('relay-plugin.json');
  if (!raw) throw new Error('The package needs a relay-plugin.json manifest.');
  if (raw.length > MAX_MANIFEST_BYTES) throw new Error('The plugin manifest is too large.');
  let manifest: PluginManifest;
  try { manifest = isManifest(JSON.parse(new TextDecoder().decode(raw))); }
  catch (error) { throw new Error(`The plugin manifest is invalid: ${error instanceof Error ? error.message : 'unknown error'}`); }
  const { capabilities, mcp } = layout(files, manifest);
  return { manifest, capabilities, mcp };
}

function layout(files: Map<string, Uint8Array>, manifest: PluginManifest): { capabilities: PluginCapabilities; mcp: McpServer[] } {
  const capabilities: PluginCapabilities = { skills: [], commands: [], agents: [], mcp: [], code: [] };
  let mcp: McpServer[] = [];
  for (const path of files.keys()) {
    if (path === 'relay-plugin.json' || path === 'README.md' || path === 'LICENSE' || path === 'LICENSE.md') continue;
    const parts = path.split('/');
    if (path === 'mcp.json') {
      const contents = new TextDecoder().decode(files.get(path));
      if (contents.length > MAX_MANIFEST_BYTES) throw new Error('The plugin mcp.json is too large.');
      mcp = parseMcp(contents);
      capabilities.mcp = mcp.map((server) => server.name);
      continue;
    }
    if (!ROOT_DIRECTORIES.has(parts[0])) throw new Error(`The package contains an unsupported file: ${path}`);
    if (parts[0] === 'skills') {
      if (parts.length < 3) throw new Error(`A skill needs its own folder: ${path}`);
      if (parts.length === 3 && parts[2] === 'SKILL.md' && !capabilities.skills.includes(parts[1])) capabilities.skills.push(parts[1]);
    } else if (parts[0] === 'commands' || parts[0] === 'agents') {
      if (parts.length !== 2 || !parts[1].endsWith('.md')) throw new Error(`A ${parts[0] === 'commands' ? 'command' : 'agent'} must be a markdown file directly inside ${parts[0]}/: ${path}`);
      const name = parts[1].slice(0, -3);
      capabilities[parts[0]].push(name);
    } else {
      if (parts.length !== 2 || !CODE_FILES.test(parts[1])) throw new Error(`Plugin code must be a JavaScript or TypeScript file directly inside plugins/: ${path}`);
      capabilities.code.push(parts[1]);
    }
  }
  for (const [directory, names] of Object.entries(capabilities) as Array<[keyof PluginCapabilities, string[]]>) {
    capabilities[directory] = [...new Set(names)].sort();
  }
  if (manifest.id.length > 64) throw new Error('The plugin id is too long.');
  return { capabilities, mcp };
}

function digest(files: Map<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    const data = files.get(path)!;
    hash.update(path); hash.update('\0'); hash.update(String(data.length)); hash.update('\0'); hash.update(data);
  }
  return hash.digest('hex');
}

function codePreviews(files: Map<string, Uint8Array>): PluginCodePreview[] {
  const previews: PluginCodePreview[] = [];
  let total = 0;
  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith('plugins/')) continue;
    const data = files.get(path)!;
    if (total >= MAX_CODE_PREVIEW_TOTAL) { previews.push({ path, content: 'Preview omitted: the code preview limit was reached.' }); continue; }
    const room = Math.min(MAX_CODE_PREVIEW_BYTES, MAX_CODE_PREVIEW_TOTAL - total);
    const raw = new TextDecoder().decode(data.slice(0, room));
    total += Math.min(data.length, room);
    previews.push({ path, content: data.length > room ? `${raw}\n\n… truncated for preview` : raw });
  }
  return previews;
}

function pluginDirectory(root: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) throw new Error('Unknown plugin.');
  return join(root, id);
}

export function mergeMcpServers(user: McpServer[], plugin: McpServer[]): McpServer[] {
  const names = new Set(user.map((server) => server.name));
  return [...user, ...plugin.filter((server) => !names.has(server.name))];
}

export class PluginManager {
  private staged = new Map<string, Staged>();
  constructor(private readonly root: string) {}

  async cleanup(): Promise<void> {
    this.staged.clear();
    await rm(join(this.root, '.staging'), { recursive: true, force: true });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async preview(path: string): Promise<PluginPreview> {
    const files = await readArchive(path);
    const { manifest, capabilities, mcp } = analyze(files);
    return this.stage(files, manifest, capabilities, mcp);
  }

  async previewDirectory(directory: string): Promise<PluginPreview> {
    const files = await readDirectory(directory);
    const { manifest, capabilities, mcp } = analyze(files);
    return this.stage(files, manifest, capabilities, mcp);
  }

  async catalog(directory: string): Promise<CatalogPlugin[]> {
    let entries: Dirent[];
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const plugins: CatalogPlugin[] = [];
    for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const root = join(directory, entry.name);
      const files = await readDirectory(root);
      const { manifest, capabilities } = analyze(files);
      if (manifest.id !== entry.name) throw new Error(`The catalog folder “${entry.name}” must match its plugin id.`);
      plugins.push({ manifest, capabilities, digest: digest(files), directory: root });
    }
    return plugins.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  private async stage(files: Map<string, Uint8Array>, manifest: PluginManifest, capabilities: PluginCapabilities, mcp: McpServer[]): Promise<PluginPreview> {
    const fileList: PluginFilePreview[] = [...files.entries()].map(([entry, data]) => ({ path: entry, size: data.length })).sort((a, b) => a.path.localeCompare(b.path));
    const token = randomUUID();
    const directory = join(this.root, '.staging', token);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      for (const [entry, data] of files) {
        const target = join(directory, ...entry.split('/'));
        await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
        await writeFile(target, data, { mode: 0o600 });
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    const preview: PluginPreview = {
      token, digest: digest(files), manifest, files: fileList, capabilities, code: codePreviews(files),
    };
    this.staged.set(token, { directory, digest: preview.digest, preview, mcp });
    return preview;
  }

  async cancel(token: string): Promise<void> {
    const entry = this.staged.get(token);
    this.staged.delete(token);
    if (entry) await rm(entry.directory, { recursive: true, force: true });
  }

  async install(token: string, allowCode: boolean): Promise<PluginRecord> {
    const entry = this.staged.get(token);
    if (!entry) throw new Error('This plugin preview has expired. Choose the ZIP again.');
    const { preview } = entry;
    if (preview.capabilities.code.length && !allowCode) throw new Error('This plugin includes executable code. Review the code and approve it before installing.');
    const target = pluginDirectory(this.root, preview.manifest.id);
    await rm(target, { recursive: true, force: true });
    await rename(entry.directory, target);
    this.staged.delete(token);
    return {
      id: preview.manifest.id, name: preview.manifest.name, version: preview.manifest.version,
      description: preview.manifest.description, digest: preview.digest, enabled: true,
      installedAt: Date.now(), capabilities: preview.capabilities, codeApproved: preview.capabilities.code.length > 0 && allowCode,
    };
  }

  async exists(id: string): Promise<boolean> {
    try { return (await stat(join(pluginDirectory(this.root, id), 'relay-plugin.json'))).isFile(); }
    catch { return false; }
  }

  async remove(id: string): Promise<void> {
    await rm(pluginDirectory(this.root, id), { recursive: true, force: true });
  }

  async mcpServers(records: PluginRecord[]): Promise<McpServer[]> {
    const servers: McpServer[] = [];
    for (const record of records.filter((item) => item.enabled)) {
      if (!(await this.exists(record.id))) continue;
      try {
        const value = JSON.parse(await readFile(join(pluginDirectory(this.root, record.id), 'mcp.json'), 'utf8'));
        const list = Array.isArray(value) ? value : value?.servers;
        if (!Array.isArray(list)) continue;
        servers.push(...list.map((server) => validateMcp(server as McpServer)));
      } catch { /* A broken declaration is reported during preview and skipped here. */ }
    }
    return servers;
  }

  async syncConfig(configDirectory: string, records: PluginRecord[]): Promise<void> {
    const managed = ['skills', 'commands', 'agents', 'plugins'];
    await rm(configDirectory, { recursive: true, force: true });
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    for (const record of records.filter((item) => item.enabled)) {
      if (!(await this.exists(record.id))) continue;
      const source = pluginDirectory(this.root, record.id);
      for (const directory of managed) {
        if (directory === 'plugins' && !record.codeApproved) continue;
        await cp(join(source, directory), join(configDirectory, directory), { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }
}
