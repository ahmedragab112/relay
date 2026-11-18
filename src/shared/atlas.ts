/** Atlas: generated project knowledge, stored inside the project at .relay/atlas. */

export const ATLAS_ROOT = '.relay/atlas';
export const ATLAS_PLAN_FILE = 'atlas_plan.yaml';
export const ATLAS_CARDS_FILE = 'knowledge/cards.json';
export const ATLAS_LANGUAGE_KEY = 'relay.atlas.language';

export const ATLAS_LANGUAGES = ['en', 'ar'] as const;
export type AtlasLanguage = typeof ATLAS_LANGUAGES[number];

export type AtlasRunState = 'idle' | 'planning' | 'writing' | 'ready' | 'error' | 'canceled';

export interface AtlasPage {
  slug: string;
  title: string;
  parent?: string;
  summary?: string;
  /** Content hash recorded when Atlas wrote this page; a mismatch means a person edited it. */
  hash?: string;
  /** Hand-added page: Atlas never rewrites or removes it. */
  pinned?: boolean;
  /** Runtime flag: the Markdown changed after generation, so Update leaves it alone. */
  edited?: boolean;
}

export interface AtlasManifest {
  version: 1;
  language: AtlasLanguage;
  project: string;
  generatedAt: number;
  baseline?: string;
  /** What the last build read besides the code: the whole project or one task's conversation. */
  source?: AtlasSource;
  pages: AtlasPage[];
}

export interface AtlasSource {
  kind: 'project' | 'task';
  /** Title of the task whose conversation grounded the build. */
  title?: string;
}

export interface AtlasNote {
  text: string;
  author?: string;
}

export interface AtlasDocument {
  title: string;
  goal?: string;
  parent?: string;
  hints?: string;
  template?: string;
}

export interface AtlasPlan {
  version: 1;
  template?: string;
  notes: AtlasNote[];
  documents: AtlasDocument[];
  cardNotes: AtlasNote[];
  include: string[];
  exclude: string[];
}

export interface AtlasStatus {
  state: AtlasRunState;
  detail?: string;
  writing?: number;
  total?: number;
  error?: string;
}

export interface AtlasProgress {
  percent: number;
  phase: string;
}

/** One 0–100 scale for the whole build: planning, per-page writing, then a full bar when ready. */
export function atlasProgress(status: AtlasStatus): AtlasProgress | undefined {
  if (status.state === 'ready') return { percent: 100, phase: 'Atlas is ready' };
  if (status.state === 'planning') return { percent: 3, phase: 'Planning pages' };
  if (status.state !== 'writing') return undefined;
  const written = Math.max(0, status.writing ?? 0);
  if (!status.total) return { percent: 10, phase: written ? `Writing pages — ${written} done` : 'Writing pages' };
  const done = Math.min(written, status.total);
  return {
    percent: Math.min(95, 10 + Math.round((85 * done) / status.total)),
    phase: `Writing pages ${done} of ${status.total}`,
  };
}

/** One module card: what it is, where it lives, and how it relates to other modules. */
export interface AtlasCard {
  name: string;
  path?: string;
  summary?: string;
  page?: string;
  dependsOn: string[];
  relatedTo: string[];
}

export interface AtlasCards {
  present: boolean;
  count: number;
  warnings: string[];
}

export interface AtlasView {
  language: AtlasLanguage;
  manifest?: AtlasManifest;
  plan: { present: boolean; warnings: string[]; documents: number };
  status: AtlasStatus;
  cards: AtlasCards;
  baseline?: { generated?: string; current?: string; stale: boolean };
}

export const isAtlasLanguage = (value: unknown): value is AtlasLanguage =>
  typeof value === 'string' && (ATLAS_LANGUAGES as readonly string[]).includes(value);

/** File-safe slug from a page title; Arabic characters are kept. */
export function atlasSlug(title: string): string {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return slug || 'page';
}

/** Keeps the first occurrence per slug and drops parents that do not exist. */
export function normalizeAtlasPages(pages: AtlasPage[]): AtlasPage[] {
  const seen = new Set<string>();
  const kept: AtlasPage[] = [];
  for (const page of pages) {
    const title = page.title.trim();
    if (!title) continue;
    const slug = atlasSlug(page.slug || title);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const entry: AtlasPage = { ...page, slug, title };
    if (!page.parent) delete entry.parent;
    kept.push(entry);
  }
  const bySlug = new Map(kept.map((page) => [page.slug, page]));
  const byTitle = new Map(kept.map((page) => [page.title, page]));
  return kept.map((page) => {
    const parent = page.parent ? bySlug.get(atlasSlug(page.parent)) ?? byTitle.get(page.parent) : undefined;
    if (!parent || parent.slug === page.slug) { const { parent: _drop, ...rest } = page; return rest; }
    return { ...page, parent: parent.slug };
  });
}

const NOTE_LIMIT = 50;
const TEXT_LIMIT = 10_000;
const AUTHOR_LIMIT = 100;
const DOCUMENT_LIMIT = 500;
const TITLE_LIMIT = 100;
const FIELD_LIMIT = 10_000;
const HINT_LIMIT = 5_000;
const TEMPLATE_LIMIT = 5_000;

interface Line { indent: number; content: string }

type Yaml = string | Yaml[] | { [key: string]: Yaml };

function stripComment(line: string): string {
  let quote = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) { if (char === quote && line[index - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  return trimmed;
}

function splitKey(text: string): [string, string] | undefined {
  let quote = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ':' && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      const key = text.slice(0, index).trim();
      return key ? [key, text.slice(index + 1).trim()] : undefined;
    }
  }
  return undefined;
}

function parseBlock(lines: Line[], start: number, indent: number): [Yaml, number] {
  if (lines[start]?.content.startsWith('- ')) {
    const items: Yaml[] = [];
    let index = start;
    while (index < lines.length && lines[index].indent === indent && lines[index].content.startsWith('- ')) {
      const body = lines[index].content.slice(2).trim();
      const pair = splitKey(body);
      if (!pair) { items.push(scalar(body)); index++; continue; }
      const object: { [key: string]: Yaml } = {};
      const [key, raw] = pair;
      object[key] = raw ? scalar(raw) : '';
      index++;
      // Additional keys of the same list item sit deeper than the dash.
      while (index < lines.length && lines[index].indent > indent && !lines[index].content.startsWith('- ')) {
        const [childKey, childRaw] = splitKey(lines[index].content) ?? ['', ''];
        if (childKey) object[childKey] = scalar(childRaw);
        index++;
      }
      items.push(object);
    }
    return [items, index];
  }
  const object: { [key: string]: Yaml } = {};
  let index = start;
  while (index < lines.length && lines[index].indent === indent && !lines[index].content.startsWith('- ')) {
    const pair = splitKey(lines[index].content);
    if (!pair) { index++; continue; }
    const [key, raw] = pair;
    if (raw) { object[key] = scalar(raw); index++; continue; }
    const next = lines[index + 1];
    if (next && next.indent > indent) {
      const [value, resume] = parseBlock(lines, index + 1, next.indent);
      object[key] = value;
      index = resume;
    } else {
      object[key] = '';
      index++;
    }
  }
  return [object, index];
}

function notes(value: Yaml | undefined, warnings: string[], domain: string): AtlasNote[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value) warnings.push(`${domain}: notes must be a list.`);
    return [];
  }
  const result: AtlasNote[] = [];
  for (const entry of value.slice(0, NOTE_LIMIT)) {
    const text = typeof entry === 'string' ? entry : typeof entry === 'object' && entry && !Array.isArray(entry) ? String(entry.text ?? '') : '';
    if (!text) continue;
    if (text.length > TEXT_LIMIT) { warnings.push(`${domain}: a note was cut at ${TEXT_LIMIT} characters.`); }
    const author = typeof entry === 'object' && entry && !Array.isArray(entry) ? String(entry.author ?? '').slice(0, AUTHOR_LIMIT) : '';
    result.push({ text: text.slice(0, TEXT_LIMIT), ...(author ? { author } : {}) });
  }
  if (value.length > NOTE_LIMIT) warnings.push(`${domain}: only the first ${NOTE_LIMIT} notes are used.`);
  return result;
}

function strings(value: Yaml | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

/** Reads the optional pre-generation plan file; a broken file degrades to warnings, never a failure. */export function parseAtlasPlan(text: string): { plan: AtlasPlan; warnings: string[] } {
  const plan: AtlasPlan = { version: 1, notes: [], documents: [], cardNotes: [], include: [], exclude: [] };
  const warnings: string[] = [];
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const content = stripComment(raw).trimEnd();
    if (!content.trim()) continue;
    const indent = content.length - content.trimStart().length;
    lines.push({ indent, content: content.trimStart() });
  }
  if (!lines.length) return { plan, warnings };
  let root: Yaml;
  try { [root] = parseBlock(lines, 0, lines[0].indent); }
  catch { return { plan, warnings: ['The plan file could not be read.'] }; }
  if (typeof root !== 'object' || !root || Array.isArray(root)) return { plan, warnings };
  if (root.version !== undefined && String(root.version) !== '1') warnings.push('Only plan version 1 is supported.');
  const atlas = (root.atlas ?? {}) as unknown as { [key: string]: Yaml };
  if (typeof atlas !== 'object' || Array.isArray(atlas)) return { plan, warnings };
  if (typeof atlas.template === 'string' && atlas.template) plan.template = atlas.template.slice(0, TEMPLATE_LIMIT);
  plan.notes = notes(atlas.notes, warnings, 'atlas');
  for (const value of Array.isArray(atlas.documents) ? atlas.documents.slice(0, DOCUMENT_LIMIT) : []) {
    if (typeof value !== 'object' || !value || Array.isArray(value)) continue;
    const title = String(value.title ?? '').trim();
    if (!title) continue;
    plan.documents.push({
      title: title.slice(0, TITLE_LIMIT),
      ...(value.goal ? { goal: String(value.goal).slice(0, FIELD_LIMIT) } : {}),
      ...(value.parent ? { parent: String(value.parent).slice(0, TITLE_LIMIT) } : {}),
      ...(value.hints ? { hints: String(value.hints).slice(0, HINT_LIMIT) } : {}),
      ...(value.template ? { template: String(value.template).slice(0, TEMPLATE_LIMIT) } : {}),
    });
  }
  if (Array.isArray(atlas.documents) && atlas.documents.length > DOCUMENT_LIMIT) warnings.push(`Only the first ${DOCUMENT_LIMIT} documents are used.`);
  const cards = (root.knowledgecard ?? {}) as unknown as { [key: string]: Yaml };
  if (cards && typeof cards === 'object' && !Array.isArray(cards)) plan.cardNotes = notes(cards.notes, warnings, 'knowledgecard');
  const scope = (root.scope ?? {}) as unknown as { [key: string]: Yaml };
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    plan.include = strings(scope.include);
    plan.exclude = strings(scope.exclude);
  }
  return { plan, warnings };
}

const CARD_LIMIT = 500;
const CARD_NAME_LIMIT = 120;
const CARD_PATH_LIMIT = 300;
const CARD_TEXT_LIMIT = 2000;
const CARD_RELATIONS = 30;

function cardNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value.slice(0, CARD_RELATIONS)) {
    const name = typeof item === 'string' ? item.trim().slice(0, CARD_NAME_LIMIT) : '';
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/** Validates knowledge cards; unknown page references are dropped, relations keep their card names. */
export function parseAtlasCards(text: string, pages: AtlasPage[]): { cards: AtlasCard[]; warnings: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { cards: [], warnings: ['knowledge/cards.json could not be read.'] }; }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { cards?: unknown }).cards) ? (raw as { cards: unknown[] }).cards : [];
  if (!list.length) return { cards: [], warnings: ['knowledge/cards.json has no cards.'] };
  const slugs = new Set(pages.map((page) => page.slug));
  const cards: AtlasCard[] = [];
  const seen = new Set<string>();
  for (const value of list.slice(0, CARD_LIMIT)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, CARD_NAME_LIMIT) : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const card = (field: unknown, limit: number): string =>
      typeof field === 'string' && field.trim() ? field.trim().slice(0, limit) : '';
    const path = card(entry.path, CARD_PATH_LIMIT);
    const summary = card(entry.summary, CARD_TEXT_LIMIT);
    const page = typeof entry.page === 'string' && slugs.has(entry.page) ? entry.page : '';
    const self = name.toLowerCase();
    cards.push({
      name,
      ...(path ? { path } : {}),
      ...(summary ? { summary } : {}),
      ...(page ? { page } : {}),
      dependsOn: cardNames(entry.dependsOn).filter((item) => item.toLowerCase() !== self),
      relatedTo: cardNames(entry.relatedTo).filter((item) => item.toLowerCase() !== self),
    });
  }
  const warnings: string[] = [];
  if (list.length > CARD_LIMIT) warnings.push(`Only the first ${CARD_LIMIT} cards are used.`);
  if (!cards.length) warnings.push('No card had a name.');
  return { cards, warnings };
}

export const ATLAS_CONTEXT_LIMIT = 6_000;

/** A compact transcript of a task, kept newest-first within the character budget. */
export function atlasTaskContext(messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>): string {
  const lines: string[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim();
    if (!text) continue;
    const line = `${message.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
    if (total + line.length + 1 > ATLAS_CONTEXT_LIMIT) continue;
    total += line.length + 1;
    lines.unshift(line);
  }
  return lines.join('\n');
}

/** The generation prompt; the agent writes plan.json and one Markdown file per page. */
export function atlasPrompt(input: {
  projectName: string;
  language: AtlasLanguage;
  plan?: AtlasPlan;
  existing?: AtlasPage[];
  protect?: AtlasPage[];
  changed?: string[];
  context?: string;
}): string {
  const language = input.language === 'ar' ? 'Arabic' : 'English';
  const plan = input.plan;
  const documents = plan?.documents.length
    ? `Use exactly this page list for the pages Atlas keeps (parent is the page title it sits under):\n${plan.documents.map((document) => `- ${document.title}${document.parent ? ` (under ${document.parent})` : ''}${document.goal ? ` — ${document.goal}` : ''}`).join('\n')}`
    : input.existing?.length
      ? 'Keep the existing pages, and add a page only when the code has a real new area. Nest at most one level.'
      : 'Choose 5-12 pages that each cover one real, cohesive area of the codebase. Nest at most one level.';
  const notes = plan?.notes.length ? `Author guidance, follow it closely:\n${plan.notes.map((note) => `- ${note.text}`).join('\n')}` : '';
  const template = plan?.template ? `Page template: ${plan.template === 'product_requirement' ? 'product requirements' : 'technical architecture'}.` : '';
  const scope = plan && (plan.include.length || plan.exclude.length)
    ? `Only treat these paths as source material. Include: ${plan.include.join(', ') || '(everything)'}. Exclude: ${plan.exclude.join(', ') || '(nothing)'}.`
    : '';
  const existing = input.existing?.length ? `Pages from the previous build: ${input.existing.map((page) => page.title).join(', ')}.` : '';
  const protect = input.protect?.length
    ? `The user edited these pages by hand; never create, rewrite or delete them, and list them unchanged in plan.json (keep their existing Markdown even if the page list below mentions them): ${input.protect.map((page) => page.title).join(', ')}.`
    : '';
  const changed = input.changed?.length
    ? `Code changed since the last build: ${input.changed.slice(0, 40).join(', ')}${input.changed.length > 40 ? ` and ${input.changed.length - 40} more files` : ''}. Rewrite only the pages those changes affect; do not rewrite any other existing page that is already on disk.`
    : input.existing?.length ? 'Rewrite existing pages unless the code clearly moved.' : '';
  return [
    `You are writing Atlas, a living technical wiki for the project “${input.projectName}”.`,
    `Work only inside ${ATLAS_ROOT}/${input.language}/. Do not modify any other file, and do not run shell commands.`,
    '',
    'Step 1 — understand the project: read README, manifests (package.json, pyproject.toml, Cargo.toml, go.mod…), and the main source directories. Use read, list, glob and grep.',
    'Step 2 — plan: ' + documents,
    `Every title and page body must be written in ${language}.`,
    template,
    notes,
    scope,
    existing,
    protect,
    changed,
    input.context?.trim() ? `Task context — the conversation behind this request; use it to focus the pages, but ground every claim in code:\n${input.context.trim()}` : '',
    '',
    `Step 3 — write ${ATLAS_ROOT}/${input.language}/plan.json with exactly this shape: {"pages":[{"slug":"kebab-case-id","title":"Page title","parent":"Optional parent slug","summary":"One sentence"}]}. List every page that should stay in Atlas, including pages you did not rewrite.`,
    `Step 4 — for every page you plan to write, write ${ATLAS_ROOT}/${input.language}/<slug>.md. Each page must contain:`,
    '- a single H1 with the page title;',
    '- a “Files referenced” list of Markdown links relative to the project root, for example [src/main/index.ts](src/main/index.ts);',
    '- a short introduction, then the project structure of that area;',
    '- the core components with their responsibilities and how data flows between them;',
    '- a Mermaid diagram inside a ```mermaid fence when it clarifies the flow;',
    '- a dependency analysis (what it imports and what imports it) and a short conclusion.',
    'Ground every claim in code you read. Never invent files, functions, or line numbers. Keep pages 200-900 words.',
    `Step 5 — write ${ATLAS_ROOT}/${input.language}/${ATLAS_CARDS_FILE} with exactly this shape: {"cards":[{"name":"Module name","path":"src/module/file.ts","summary":"One or two sentences","page":"page-slug","dependsOn":["Other module"],"relatedTo":["Other module"]}]}. Write 4-12 cards, one per main module; use card names in dependsOn and relatedTo; every path must be a real file.`,
    'When every page and card is written, reply with a one-line summary of what you created.',
  ].filter(Boolean).join('\n');
}
