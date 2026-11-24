/** Knowledge: the user's saved sources, stored app-wide and available to every task. */

export const KNOWLEDGE_DIR = 'knowledge';
export const KNOWLEDGE_LIBRARY_FILE = 'library.json';
export const KNOWLEDGE_TEXT_LIMIT = 400_000;
export const KNOWLEDGE_NOTE_LIMIT = 200_000;
export const KNOWLEDGE_TITLE_LIMIT = 120;
export const KNOWLEDGE_SOURCE_LIMIT = 500;

export type KnowledgeKind = 'note' | 'file' | 'link';

export interface KnowledgeSource {
  id: string;
  title: string;
  kind: KnowledgeKind;
  /** Where the source came from: a file path or a URL. Notes have none. */
  origin?: string;
  /** Extracted plain text; this is what the agent receives. */
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeMeta {
  id: string;
  title: string;
  kind: KnowledgeKind;
  origin?: string;
  createdAt: number;
  updatedAt: number;
  size: number;
  excerpt: string;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  kind: KnowledgeKind;
  origin?: string;
  snippet: string;
  updatedAt: number;
  score: number;
}

export const isKnowledgeKind = (value: unknown): value is KnowledgeKind =>
  value === 'note' || value === 'file' || value === 'link';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const name = body.toLowerCase();
    if (name.startsWith('#x')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

/** Flattens line endings and redundant whitespace while keeping paragraph breaks. */
export function normalizeKnowledgeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Readable text from an HTML page: scripts and markup dropped, blocks kept on their own lines. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/blockquote|\/pre|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  return normalizeKnowledgeText(decodeEntities(body));
}

/** The title of an HTML page, decoded and trimmed. */
export function htmlTitle(html: string): string | undefined {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = raw ? normalizeKnowledgeText(decodeEntities(raw)) : '';
  return title || undefined;
}

export function knowledgeTitle(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, KNOWLEDGE_TITLE_LIMIT);
  return cleaned || fallback;
}

export function knowledgeExcerpt(text: string, limit = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function knowledgeMeta(source: KnowledgeSource): KnowledgeMeta {
  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    ...(source.origin ? { origin: source.origin } : {}),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    size: source.text.length,
    excerpt: knowledgeExcerpt(source.text),
  };
}

function knowledgeSnippet(text: string, query: string): string {
  const source = text.replace(/\s+/g, ' ').trim();
  const index = source.toLowerCase().indexOf(query);
  if (index < 0) return knowledgeExcerpt(source);
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + query.length + 80);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

export function searchKnowledge(sources: KnowledgeSource[], query: string, limit = 30): KnowledgeHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: KnowledgeHit[] = [];
  for (const source of sources) {
    const titleMatch = source.title.toLowerCase().includes(needle);
    const bodyMatch = source.text.toLowerCase().includes(needle);
    if (!titleMatch && !bodyMatch) continue;
    hits.push({
      id: source.id,
      title: source.title,
      kind: source.kind,
      ...(source.origin ? { origin: source.origin } : {}),
      snippet: bodyMatch ? knowledgeSnippet(source.text, needle) : source.title,
      updatedAt: source.updatedAt,
      score: titleMatch ? (bodyMatch ? 3 : 2) : 1,
    });
  }
  return hits
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

/** Validates a saved library file; entries that cannot be used are dropped, never thrown on. */
export function parseKnowledgeLibrary(text: string): KnowledgeSource[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { sources?: unknown }).sources)
    ? (raw as { sources: unknown[] }).sources
    : [];
  const sources: KnowledgeSource[] = [];
  const seen = new Set<string>();
  for (const value of list.slice(0, KNOWLEDGE_SOURCE_LIMIT)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 64) : '';
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, KNOWLEDGE_TITLE_LIMIT) : '';
    const body = typeof entry.text === 'string' ? entry.text : '';
    if (!id || !title || !body.trim() || seen.has(id) || !isKnowledgeKind(entry.kind)) continue;
    seen.add(id);
    const origin = typeof entry.origin === 'string' && entry.origin.trim() ? entry.origin.trim().slice(0, 2048) : '';
    const createdAt = typeof entry.createdAt === 'number' && entry.createdAt > 0 ? entry.createdAt : 0;
    const updatedAt = typeof entry.updatedAt === 'number' && entry.updatedAt > 0 ? entry.updatedAt : createdAt;
    sources.push({
      id,
      title,
      kind: entry.kind,
      ...(origin ? { origin } : {}),
      text: body.slice(0, KNOWLEDGE_TEXT_LIMIT),
      createdAt,
      updatedAt,
    });
  }
  return sources;
}

export const KNOWLEDGE_INDEX_LIMIT = 4_000;

/** A compact library index for the agent: what exists, where it came from, and a short taste of each source. */
export function formatKnowledgeIndex(sources: KnowledgeSource[], directory: string): string {
  if (!sources.length) return '';
  const lines = [
    'Knowledge is a saved library the user keeps in Relay. It belongs to no project and is available to every task.',
    `The full library is stored in ${directory}/library.json. The excerpts below are cut; when one matters, ask the user to attach it with @knowledge in the composer.`,
    '',
    'Saved sources:',
  ];
  let used = lines.join('\n').length;
  let listed = 0;
  for (const source of sources) {
    const excerpt = knowledgeExcerpt(source.text, 220);
    const origin = source.origin ? ` · ${source.origin}` : '';
    const line = `- ${source.title} [${source.kind}${origin}]${excerpt ? ` — ${excerpt}` : ''}`;
    if (used + line.length + 1 > KNOWLEDGE_INDEX_LIMIT) break;
    used += line.length + 1;
    listed++;
    lines.push(line);
  }
  if (listed < sources.length) lines.push(`- ${sources.length - listed} more sources in the library.`);
  return lines.join('\n');
}
