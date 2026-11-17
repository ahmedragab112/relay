import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ATLAS_CARDS_FILE, ATLAS_LANGUAGES, ATLAS_ROOT, normalizeAtlasPages, parseAtlasCards,
  type AtlasCard, type AtlasLanguage, type AtlasManifest, type AtlasPage,
} from '../shared/atlas.js';

const INDEX_PAGES = 60;
const INDEX_CARDS = 24;
const INDEX_LIMIT = 5_000;
const MANIFEST_LIMIT = 1024 * 1024;
const CARDS_LIMIT = 2 * 1024 * 1024;

async function readCapped(path: string, limit: number): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > limit) return undefined;
    return await readFile(path, 'utf8');
  } catch { return undefined; }
}

async function readManifest(directory: string, language: AtlasLanguage): Promise<AtlasManifest | undefined> {
  const contents = await readCapped(join(directory, ATLAS_ROOT, language, 'manifest.json'), MANIFEST_LIMIT);
  if (!contents) return undefined;
  let raw: Partial<AtlasManifest>;
  try { raw = JSON.parse(contents) as Partial<AtlasManifest>; } catch { return undefined; }
  if (raw?.version !== 1 || !Array.isArray(raw.pages)) return undefined;
  const rows: AtlasPage[] = [];
  for (const page of raw.pages) {
    if (!page || typeof page !== 'object') continue;
    const title = typeof page.title === 'string' ? page.title.trim() : '';
    if (!title) continue;
    rows.push({
      title: title.slice(0, 200),
      slug: typeof page.slug === 'string' && page.slug ? page.slug : title,
      ...(typeof page.parent === 'string' && page.parent ? { parent: page.parent } : {}),
      ...(typeof page.summary === 'string' && page.summary ? { summary: page.summary.replace(/\s+/g, ' ').slice(0, 400) } : {}),
    });
  }
  const pages = normalizeAtlasPages(rows);
  if (!pages.length) return undefined;
  return {
    version: 1,
    language,
    project: typeof raw.project === 'string' ? raw.project : '',
    generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : 0,
    pages,
    ...(typeof raw.baseline === 'string' && raw.baseline ? { baseline: raw.baseline } : {}),
  };
}

async function readCards(directory: string, language: AtlasLanguage, pages: AtlasPage[]): Promise<AtlasCard[]> {
  const contents = await readCapped(join(directory, ATLAS_ROOT, language, ATLAS_CARDS_FILE), CARDS_LIMIT);
  if (!contents) return [];
  return parseAtlasCards(contents, pages).cards;
}

/** Compact Atlas index: where the wiki is, which pages exist, and how the modules relate. */
export function formatAtlasIndex(language: AtlasLanguage, pages: AtlasPage[], cards: AtlasCard[]): string {
  const root = `${ATLAS_ROOT}/${language}`;
  const lines: string[] = [
    `Atlas keeps a living technical wiki for this project in ${root}/. The code is the source of truth; the wiki explains how the parts fit together.`,
    `Before changing an area below, read its page by exact path with the read tool. The folder is hidden, so pass the full .md path.`,
    '',
    'Pages:',
  ];
  const children = new Map<string, AtlasPage[]>();
  for (const page of pages) if (page.parent) children.set(page.parent, [...(children.get(page.parent) ?? []), page]);
  let listed = 0;
  const add = (page: AtlasPage, depth: string): void => {
    if (listed >= INDEX_PAGES) return;
    listed++;
    const summary = page.summary ? ` — ${page.summary}` : '';
    lines.push(`${depth}- ${page.title} (${root}/${page.slug}.md)${summary}`);
    for (const child of children.get(page.slug) ?? []) add(child, `${depth}  `);
  };
  for (const page of pages.filter((item) => !item.parent)) add(page, '');
  if (listed < pages.length) lines.push(`- ${pages.length - listed} more pages in ${root}/.`);
  if (cards.length) {
    lines.push('', 'Knowledge cards:');
    for (const card of cards.slice(0, INDEX_CARDS)) {
      const parts = [card.name, ...(card.path ? [card.path] : []), ...(card.summary ? [card.summary] : [])];
      if (card.dependsOn.length) parts.push(`depends on ${card.dependsOn.join(', ')}`);
      if (card.relatedTo.length) parts.push(`related to ${card.relatedTo.join(', ')}`);
      lines.push(`- ${parts.join(' — ')}`);
    }
    if (cards.length > INDEX_CARDS) lines.push(`- ${cards.length - INDEX_CARDS} more cards in ${root}/${ATLAS_CARDS_FILE}.`);
  }
  lines.push('', 'When the task changes code an Atlas page covers, keep that page consistent with the change.');
  const text = lines.join('\n');
  return text.length > INDEX_LIMIT ? `${text.slice(0, INDEX_LIMIT)}\n(Atlas index truncated; read the folder for the rest.)` : text;
}

/** Reads the project's Atlas wiki, preferring English; the Markdown folders are read by the agent directly. */
export async function loadAtlasIndex(directory: string): Promise<string | undefined> {
  if (!directory) return undefined;
  for (const language of ATLAS_LANGUAGES) {
    const manifest = await readManifest(directory, language);
    if (!manifest) continue;
    return formatAtlasIndex(language, manifest.pages, await readCards(directory, language, manifest.pages));
  }
  return undefined;
}
