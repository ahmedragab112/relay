import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { CatalogSkillEntry } from '../shared/contracts.js';
import { parseSkillFile, skillIdFromName } from './skills.js';

const MAX_FILES = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function junk(path: string): boolean {
  return path.startsWith('__MACOSX/') || basename(path) === '.DS_Store' || basename(path) === 'Thumbs.db';
}

function frontmatterValue(text: string, key: string): string {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
  if (!block) return '';
  for (const line of block[1].split('\n')) {
    const match = new RegExp(`^${key}:\\s*(.*)$`, 'i').exec(line);
    if (match) return match[1].trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  }
  return '';
}

async function readSkill(directory: string, id: string): Promise<CatalogSkillEntry | undefined> {
  let text: string;
  try { text = await readFile(join(directory, 'SKILL.md'), 'utf8'); }
  catch { return undefined; }
  let parsed: ReturnType<typeof parseSkillFile>;
  try { parsed = parseSkillFile(text); }
  catch { return undefined; }
  const order = Number(frontmatterValue(text, 'order'));
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    category: frontmatterValue(text, 'category') || 'General',
    order: Number.isFinite(order) ? order : 999,
  };
}

export class SkillCatalog {
  constructor(private readonly root: string) {}

  async list(): Promise<CatalogSkillEntry[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const skills: CatalogSkillEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !SKILL_ID.test(entry.name)) continue;
      const skill = await readSkill(join(this.root, entry.name), entry.name);
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.name.localeCompare(b.name));
  }

  async files(value: string): Promise<Map<string, Uint8Array>> {
    const id = typeof value === 'string' ? value.trim() : '';
    let directory = '';
    if (SKILL_ID.test(id)) {
      try { if ((await stat(join(this.root, id))).isDirectory()) directory = join(this.root, id); }
      catch { directory = ''; }
    }
    if (!directory) throw new Error('This skill is not available in the bundled catalog.');
    let entries;
    try { entries = await readdir(directory, { recursive: true, withFileTypes: true }); }
    catch { throw new Error('This skill is not available in the bundled catalog.'); }
    const files = new Map<string, Uint8Array>();
    let total = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const absolute = join(entry.parentPath, entry.name);
      const path = relative(directory, absolute).split(sep).join('/');
      if (junk(path)) continue;
      if (!entry.isFile() || path.includes('\\') || path.startsWith('..')) throw new Error(`The bundled skill contains an unsupported file: ${path}`);
      if (files.size >= MAX_FILES) throw new Error(`A bundled skill may contain at most ${MAX_FILES} files.`);
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error(`The bundled skill contains an unsupported file: ${path}`);
      if (info.size > MAX_FILE_BYTES) throw new Error(`A bundled skill file is larger than 2 MB: ${path}`);
      total += info.size;
      if (total > MAX_TOTAL_BYTES) throw new Error('A bundled skill may expand to at most 20 MB.');
      files.set(path, new Uint8Array(await readFile(absolute)));
    }
    if (!files.has('SKILL.md')) throw new Error('This skill is not available in the bundled catalog.');
    const declared = skillIdFromName(parseSkillFile(new TextDecoder().decode(files.get('SKILL.md'))).name);
    if (declared !== id) throw new Error('This skill is not available in the bundled catalog.');
    return files;
  }
}
