import type { SkillRegistryEntry } from '../shared/contracts.js';
import { validateDigest } from './import.js';
import { skillIdFromName, validateSkillURL } from './skills.js';

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_ENTRIES = 200;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 600;
const SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function rowsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const skills = (payload as { skills?: unknown }).skills;
    if (Array.isArray(skills)) return skills;
  }
  throw new Error('The skill registry must be a JSON list of skills or an object with a "skills" list.');
}

export function parseSkillRegistry(payload: unknown): SkillRegistryEntry[] {
  const entries: SkillRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const item of rowsOf(payload)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || name.length > MAX_NAME) continue;
    let url: string;
    try { url = validateSkillURL(row.url); } catch { continue; }
    if (seen.has(url)) continue;
    const description = typeof row.description === 'string' ? row.description.trim().slice(0, MAX_DESCRIPTION) : '';
    const declared = typeof row.id === 'string' && SKILL_ID.test(row.id.trim()) ? row.id.trim() : '';
    let id = declared;
    if (!id) {
      try { id = skillIdFromName(name); } catch { continue; }
    }
    let sha256: string | undefined;
    if (row.sha256 !== undefined && row.sha256 !== null && row.sha256 !== '') {
      try { sha256 = validateDigest(row.sha256); } catch { continue; }
    }
    seen.add(url);
    entries.push({ id, name, description, url, ...(sha256 ? { sha256 } : {}) });
    if (entries.length >= MAX_ENTRIES) break;
  }
  if (!entries.length) throw new Error('The skill registry has no usable skill entries.');
  return entries;
}

export interface RegistryOptions {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}

async function downloadRegistry(start: string, options: RegistryOptions): Promise<SkillRegistryEntry[]> {
  const request = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    let current = start;
    let redirects = 0;
    while (true) {
      const response = await request(current, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' } });
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('The skill registry redirected without a destination.');
        if (++redirects > MAX_REDIRECTS) throw new Error('The skill registry redirected too many times.');
        let next: URL;
        try { next = new URL(location, current); } catch { throw new Error('The skill registry redirected to an invalid address.'); }
        current = validateSkillURL(next.toString());
        continue;
      }
      if (!response.ok) throw new Error(`The skill registry failed with HTTP ${response.status}.`);
      if (!response.body) throw new Error('The skill registry returned no data.');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('The skill registry is larger than 1 MB.');
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error('The skill registry is larger than 1 MB.');
        }
        chunks.push(value);
      }
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')); }
      catch { throw new Error('The skill registry is not valid JSON.'); }
      return parseSkillRegistry(payload);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The skill registry request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class SkillRegistry {
  private cached = new Map<string, { at: number; entries: SkillRegistryEntry[] }>();

  constructor(private readonly options: RegistryOptions = {}) {}

  async list(value: string): Promise<SkillRegistryEntry[]> {
    const url = validateSkillURL(value);
    const now = this.options.now?.() ?? Date.now();
    const cached = this.cached.get(url);
    if (cached && now - cached.at < (this.options.ttlMs ?? 10 * 60_000)) return cached.entries;
    const entries = await downloadRegistry(url, this.options);
    this.cached.set(url, { at: now, entries });
    return entries;
  }

  clear(): void { this.cached.clear(); }
}
