/** Design: pages built in a project sandbox at .relay/design, styled by .relay/design-system.json. */

import type { AutoSettings, ContextBlock, ModelOption, SkillOption } from './contracts';

export const DESIGN_ROOT = '.relay/design';
export const DESIGN_SYSTEM_FILE = '.relay/design-system.json';
export const DESIGN_SYSTEMS_FILE = '.relay/design-systems.json';
export const DESIGN_COMMENTS_FILE = 'comments.json';
export const DESIGN_ENTRY = 'index.html';
export const DESIGN_BRIEF = 'DESIGN.md';
export const DESIGN_VERSIONS = 'versions';
export const DESIGN_TITLE_PREFIX = 'Design · ';
export const DESIGN_MAX_BYTES = 512 * 1024;

export interface DesignColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  border: string;
}

export interface DesignTypography {
  heading: string;
  body: string;
  mono: string;
  /** Base font size in px. */
  base: number;
  /** Modular scale between steps, e.g. 1.25. */
  scale: number;
}

export interface DesignShape {
  /** Spacing unit in px. */
  space: number;
  /** Corner radius in px. */
  radius: number;
  shadow: string;
}

export interface DesignSystem {
  version: 1;
  name: string;
  notes: string;
  colors: DesignColors;
  type: DesignTypography;
  shape: DesignShape;
  updatedAt?: number;
}

/** A named system in the project's library, applied per design. */
export interface DesignSystemEntry extends DesignSystem {
  id: string;
}

/** What a design is making: a web page, a slide deck or a whiteboard. */
export type DesignKind = 'page' | 'slides' | 'board';

export const designKind = (value: unknown): DesignKind =>
  value === 'slides' || value === 'board' ? value : 'page';

export interface DesignEntry {
  slug: string;
  title: string;
  updatedAt: number;
  versions: number;
  /** The visible engine task behind this design's iterations. */
  sessionId?: string;
  /** Model chosen for this design's turns; absent means Auto. */
  model?: string;
  /** Library system applied to this design; absent means the project system. */
  systemId?: string;
  /** Absent means an ordinary web page design. */
  kind?: DesignKind;
}

export interface DesignVersion {
  version: number;
  savedAt: number;
}

/** One screen of a design: an HTML file inside the design folder. */
export interface DesignPage {
  file: string;
  name: string;
}

/** A review note on a page; open comments go to the agent as one revision turn. */
export interface DesignComment {
  id: string;
  page: string;
  /** Element selector or a short label; empty when the note is about the page. */
  selector: string;
  note: string;
  status: 'open' | 'sent';
  createdAt: number;
}

export interface DesignView {
  designs: DesignEntry[];
  system: DesignSystem;
  /** Named systems designs can be bound to; the project system is separate. */
  systems: DesignSystemEntry[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const DEFAULT_COLORS: DesignColors = {
  background: '#0b0d10',
  surface: '#12151a',
  text: '#e8eaed',
  muted: '#9aa3ad',
  primary: '#4f8cff',
  accent: '#22d3a7',
  border: '#232830',
};

export function defaultDesignSystem(): DesignSystem {
  return {
    version: 1,
    name: 'Relay',
    notes: '',
    colors: { ...DEFAULT_COLORS },
    type: { heading: 'Georgia, serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.25 },
    shape: { space: 8, radius: 12, shadow: '0 12px 32px rgba(0,0,0,.28)' },
  };
}

/** A named visual direction applied over the project's design system. */
export interface DesignSystemPreset {
  id: string;
  name: string;
  summary: string;
  notes: string;
  colors: DesignColors;
  type: DesignTypography;
  shape: DesignShape;
}

export const DESIGN_SYSTEM_PRESETS: DesignSystemPreset[] = [
  {
    id: 'editorial', name: 'Editorial',
    summary: 'Warm paper, serif headlines, quiet rules',
    notes: 'Editorial and human. Serif headlines with generous line-height, hairline rules instead of boxes, one warm accent used sparingly.',
    colors: { background: '#f7f3ec', surface: '#fffdf8', text: '#1b1a17', muted: '#6e675d', primary: '#b4552d', accent: '#2f6152', border: '#e3dbcd' },
    type: { heading: 'Iowan Old Style, Georgia, serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 17, scale: 1.3 },
    shape: { space: 8, radius: 3, shadow: '0 1px 0 rgba(27,26,23,.12)' },
  },
  {
    id: 'swiss', name: 'Swiss grid',
    summary: 'White, black, one red; strict type grid',
    notes: 'International typographic style. Flush-left type, strong grid, no decoration. Red only for emphasis and state.',
    colors: { background: '#ffffff', surface: '#f4f4f4', text: '#111111', muted: '#666666', primary: '#d7261e', accent: '#111111', border: '#dcdcdc' },
    type: { heading: 'Helvetica Neue, Arial, sans-serif', body: 'Helvetica Neue, Arial, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.33 },
    shape: { space: 8, radius: 0, shadow: 'none' },
  },
  {
    id: 'warm-minimal', name: 'Warm minimal',
    summary: 'Soft neutrals, sage primary, rounded cards',
    notes: 'Calm and product-like. Soft shadows, rounded cards, muted sage primary with a honey accent for highlights.',
    colors: { background: '#fbf9f6', surface: '#ffffff', text: '#2a2724', muted: '#7a736c', primary: '#3f6f5e', accent: '#d9a441', border: '#e6e1da' },
    type: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.25 },
    shape: { space: 8, radius: 14, shadow: '0 10px 30px rgba(42,39,36,.08)' },
  },
  {
    id: 'brutalist', name: 'Neo-brutalist',
    summary: 'Loud yellow, hard borders, offset shadows',
    notes: 'Deliberately blunt. Thick black borders, zero radius, offset hard shadows, heavy display headings, one hot accent.',
    colors: { background: '#f2e94e', surface: '#ffffff', text: '#111111', muted: '#4a4a4a', primary: '#111111', accent: '#ff5c38', border: '#111111' },
    type: { heading: 'Archivo Black, Impact, sans-serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.4 },
    shape: { space: 10, radius: 0, shadow: '6px 6px 0 #111111' },
  },
  {
    id: 'midnight', name: 'Midnight',
    summary: 'Deep navy, electric blue, soft glow',
    notes: 'Dark, focused product UI. Layered navy surfaces, electric blue primary, mint accent for positive states, soft glows instead of hard borders.',
    colors: { background: '#0b1020', surface: '#131a2e', text: '#e6ebff', muted: '#98a2c0', primary: '#6c8cff', accent: '#3ee6c1', border: '#222b45' },
    type: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.25 },
    shape: { space: 8, radius: 10, shadow: '0 18px 40px rgba(0,0,0,.5)' },
  },
  {
    id: 'pastel', name: 'Soft pastel',
    summary: 'Lilac wash, rounded shapes, friendly type',
    notes: 'Friendly and light. Lilac-tinted surfaces, pill buttons, rounded display type, pink accent for delight without noise.',
    colors: { background: '#fdf7ff', surface: '#ffffff', text: '#3a2f4d', muted: '#7d7291', primary: '#8b6cf0', accent: '#f19ac2', border: '#ece3f7' },
    type: { heading: 'ui-rounded, system-ui, sans-serif', body: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', base: 16, scale: 1.28 },
    shape: { space: 8, radius: 18, shadow: '0 14px 36px rgba(139,108,240,.16)' },
  },
];

/** Applies a preset to the project system; the project keeps its own name. */
export function applyDesignSystemPreset(current: DesignSystem, preset: DesignSystemPreset): DesignSystem {
  return {
    version: 1,
    name: current.name,
    notes: preset.notes,
    colors: { ...preset.colors },
    type: { ...preset.type },
    shape: { ...preset.shape },
  };
}

/** A starting brief for a new design; the reader can edit it before generating. */
export interface DesignTemplate {
  id: string;
  name: string;
  summary: string;
  brief: string;
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'landing', name: 'Landing page',
    summary: 'Hero, features, proof, call to action',
    brief: 'Design a marketing landing page for this project. Build a home page with a decisive hero (one headline, one supporting line, one primary action), a three-up feature section, a social-proof band, a closing call to action, and a compact footer. Write real marketing copy for this project rather than lorem ipsum, give the page a distinctive visual angle that fits the brand, and make every section reflow cleanly on a phone.',
  },
  {
    id: 'dashboard', name: 'Dashboard',
    summary: 'Sidebar, KPIs, chart, table',
    brief: 'Design an analytics dashboard for this project. Build an app shell with a left navigation, a header with a date range and search, a row of four KPI cards, a primary trend chart, a secondary breakdown, and a dense data table with sorting and status badges. Include the realistic empty, loading and no-results states for the chart and table, and make the layout hold together from a wide monitor down to a tablet.',
  },
  {
    id: 'mobile', name: 'Mobile app',
    summary: 'Phone-first home, detail and profile',
    brief: 'Design a phone-first mobile app flow for this project. Build three linked screens: a home screen with a greeting, a searchable list and a floating primary action; a detail screen for one item with clear hierarchy and a sticky action bar; and a profile or settings screen. Use thumb-friendly targets, safe-area spacing, bottom navigation where it fits, and make the screens hold together at 390 wide.',
  },
  {
    id: 'pricing', name: 'Pricing page',
    summary: 'Tiers, billing toggle, comparison',
    brief: 'Design a pricing page for this project. Build a hero with a monthly/annual billing toggle, three plan cards with one clearly recommended, a feature comparison table, a short FAQ, and a closing call to action. Show the discounted annual state correctly when the toggle flips, keep the cards scannable, and reflow the table into readable cards on a phone.',
  },
  {
    id: 'onboarding', name: 'Sign-up flow',
    summary: 'Three steps, validation, success',
    brief: 'Design a sign-up and onboarding flow for this project. Build a welcome screen, a three-step form (account details, workspace or preferences, invite the team), and a success screen. Show inline validation, disabled and error states on every field, a visible progress indicator, and a friendly way to skip optional steps. Keep each step to one decision.',
  },
  {
    id: 'portfolio', name: 'Portfolio',
    summary: 'Case study grid and detail page',
    brief: 'Design a portfolio site for this project. Build a home page with a strong introduction, a filterable case-study grid and a contact call to action, plus one case-study detail page with a cover, context, process, results and next-project link. Write credible project copy, give the imagery clear art direction, and keep the grid effortless to scan on a phone.',
  },
];

export function designTemplate(id: string): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find((template) => template.id === id);
}

/** Craft skills every design turn should carry, in priority order. */
const DESIGN_SKILL_NAMES = ['design systems', 'accessibility', 'ux copy', 'ui motion', 'css architecture', 'forms'];

/** Drops the punctuation that differs between a skill id and its display name. */
function skillKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

/** Installed design skills, strongest first, for pre-selecting a design turn. */
export function defaultDesignSkills(skills: SkillOption[]): string[] {
  const ranked: Array<{ id: string; rank: number }> = [];
  for (const skill of skills) {
    const keys = [skillKey(skill.name), skillKey(skill.id.split(/[\\/]/).pop() ?? '')];
    const rank = keys.reduce((best, key) => {
      const index = DESIGN_SKILL_NAMES.indexOf(key);
      return index >= 0 && (best < 0 || index < best) ? index : best;
    }, -1);
    if (rank >= 0) ranked.push({ id: skill.id, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.id).slice(0, DESIGN_SKILL_NAMES.length);
}

export const DESIGN_MAX_FILES = 10;
export const DESIGN_MAX_SKILLS = 24;
export const DESIGN_MAX_AGENTS = 4;
export const DESIGN_MAX_CONTEXT = 4;

/** Everything a design turn can carry besides its request, cleaned at the IPC boundary. */
export interface DesignExtras {
  files: string[];
  skills: string[];
  agents: string[];
  context: ContextBlock[];
}

function strings(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, maxLength);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/** Reads a renderer-supplied extras payload into complete, capped lists. */
export function designExtras(value: unknown): DesignExtras {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const context: ContextBlock[] = [];
  if (Array.isArray(raw.context)) {
    for (const item of raw.context) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const block = item as Record<string, unknown>;
      const label = typeof block.label === 'string' ? block.label.trim().slice(0, 120) : '';
      const textValue = typeof block.text === 'string' ? block.text.trim().slice(0, 4000) : '';
      if (!label || !textValue) continue;
      context.push({ label, text: textValue });
      if (context.length >= DESIGN_MAX_CONTEXT) break;
    }
  }
  return {
    files: strings(raw.files, DESIGN_MAX_FILES, 4096),
    skills: strings(raw.skills, DESIGN_MAX_SKILLS, 256),
    agents: strings(raw.agents, DESIGN_MAX_AGENTS, 128),
    context,
  };
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function font(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[^\w\s,'"-]/g, '').trim().slice(0, 120);
  return clean || fallback;
}

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

function shadow(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[;{}<>]/g, '').trim().slice(0, 120);
  return clean || fallback;
}

/** Reads any stored shape into a complete, safe design system. */
export function normalizeDesignSystem(raw: unknown): DesignSystem {
  const base = defaultDesignSystem();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const value = raw as Partial<DesignSystem>;
  const colors = (value.colors && typeof value.colors === 'object' ? value.colors : {}) as Partial<DesignColors>;
  const type = (value.type && typeof value.type === 'object' ? value.type : {}) as Partial<DesignTypography>;
  const shape = (value.shape && typeof value.shape === 'object' ? value.shape : {}) as Partial<DesignShape>;
  return {
    version: 1,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 80) : base.name,
    notes: typeof value.notes === 'string' ? value.notes.slice(0, 4000) : '',
    colors: {
      background: color(colors.background, base.colors.background),
      surface: color(colors.surface, base.colors.surface),
      text: color(colors.text, base.colors.text),
      muted: color(colors.muted, base.colors.muted),
      primary: color(colors.primary, base.colors.primary),
      accent: color(colors.accent, base.colors.accent),
      border: color(colors.border, base.colors.border),
    },
    type: {
      heading: font(type.heading, base.type.heading),
      body: font(type.body, base.type.body),
      mono: font(type.mono, base.type.mono),
      base: Math.round(clamp(type.base, 12, 22, base.type.base)),
      scale: Math.round(clamp(type.scale, 1.05, 1.6, base.type.scale) * 100) / 100,
    },
    shape: {
      space: Math.round(clamp(shape.space, 2, 24, base.shape.space)),
      radius: Math.round(clamp(shape.radius, 0, 48, base.shape.radius)),
      shadow: shadow(shape.shadow, base.shape.shadow),
    },
    ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt } : {}),
  };
}

/** The exact token block a generated page should start from. */
export function designCssVariables(system: DesignSystem): string {
  const { colors, type, shape } = system;
  return [
    `--ds-background:${colors.background}`,
    `--ds-surface:${colors.surface}`,
    `--ds-text:${colors.text}`,
    `--ds-muted:${colors.muted}`,
    `--ds-primary:${colors.primary}`,
    `--ds-accent:${colors.accent}`,
    `--ds-border:${colors.border}`,
    `--ds-font-heading:${type.heading}`,
    `--ds-font-body:${type.body}`,
    `--ds-font-mono:${type.mono}`,
    `--ds-base:${type.base}px`,
    `--ds-scale:${type.scale}`,
    `--ds-space:${shape.space}px`,
    `--ds-radius:${shape.radius}px`,
    `--ds-shadow:${shape.shadow}`,
  ].join(';');
}

export function designSystemCss(system: DesignSystem): string {
  return `:root{${designCssVariables(system)}}`;
}

/**
 * The strongest model a design may use when the composer is on Auto: the most
 * capable connected model the Auto settings allow, not the cheapest one.
 */
export function strongestModel(models: ModelOption[], settings?: Partial<AutoSettings>): { id: string; variant: string } | undefined {
  const includeFree = settings?.includeFree ?? true;
  const allowed = settings?.modelIds?.length ? new Set(settings.modelIds) : null;
  const best = models
    .filter((model) => model.connected && !model.limited)
    .filter((model) => includeFree || !model.free)
    .filter((model) => settings?.includeEngineHosted === true || !model.engineHosted)
    .filter((model) => !allowed || allowed.has(model.id))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || (b.context ?? 0) - (a.context ?? 0))[0];
  return best ? { id: best.id, variant: best.variants?.[0] ?? '' } : undefined;
}

/** "Checkout Flow" → "checkout-flow"; empty or unusable names are refused. */
export function designSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!slug) throw new Error('Use letters or numbers in the design name.');
  return slug;
}

export const isDesignSlug = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);

/** "checkout-flow" → "Checkout flow" */
export function designTitle(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return 'Design';
  const [first, ...rest] = words;
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** "Order status" → "order-status.html"; unusable names are refused. */
export function designPageFile(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!slug) throw new Error('Use letters or numbers in the page name.');
  if (slug === DESIGN_VERSIONS) throw new Error('That page name is reserved.');
  return `${slug}.html`;
}

/** The screen label shown on an artboard: its title tag, or a readable file name. */
export function designPageTitle(file: string, html = ''): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (title) return title.slice(0, 80);
  const base = (file.split('/').pop() ?? '').replace(/\.html?$/i, '');
  if (!base) return 'Page';
  if (base.toLowerCase() === 'index') return 'Home';
  const words = base.split(/[-_]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1));
  return words.join(' ').slice(0, 80) || 'Page';
}

/** A page as the app should store it, without the preview layer Relay injects while serving. */
export function cleanDesignPage(html: string): string {
  const clean = html
    .replace(/<style id="(?:relay-design-system|relay-preview-motion|relay-pick-style|relay-edit-style)"[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script id="relay-preview-runtime"[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<div id="(?:relay-pick-box|relay-pick-tag)"[^>]*><\/div>/gi, '')
    .replace(/\scontenteditable(?:="[^"]*")?/gi, '')
    .trim();
  if (!clean) return '';
  return /^<!doctype/i.test(clean) ? clean : `<!doctype html>\n${clean}`;
}

export function nextVersion(existing: readonly number[]): number {
  return existing.reduce((top, value) => Math.max(top, value), 0) + 1;
}

export const designSessionTitle = (slug: string): string => `${DESIGN_TITLE_PREFIX}${designTitle(slug)}`;

export const isDesignSession = (item: { title: string }): boolean => item.title.startsWith(DESIGN_TITLE_PREFIX);

export interface DesignPromptInput {
  projectName: string;
  slug: string;
  request: string;
  system: DesignSystem;
  existing: string[];
  revision: boolean;
  /** Loopback base URL the agent can open in its browser, without a trailing slash. */
  previewUrl?: string;
  /** Slide decks and whiteboards add their own format rules. */
  kind?: DesignKind;
}

const KIND_RULES: Record<Exclude<DesignKind, 'page'>, string[]> = {
  slides: [
    '## Format: slide deck',
    'index.html is a deck, not a scrolling page: one <section class="slide"> per slide, each a 16:9 frame stacked with scroll-snap. Keep the starter shell working — arrow keys and space move between slides, the slide counter stays current, and every slide fills the viewport with no page-level scroll outside the slides.',
    'Slide copy is short: one headline and at most four short lines per slide. Use the slide sequence for the argument — title, problem, idea, detail, close — and keep one idea per slide.',
    'Write the deck content in real copy, never lorem ipsum. Keep the deck previewable offline with no external assets.',
  ],
  board: [
    '## Format: whiteboard',
    'index.html is a whiteboard, not a scrolling page: a large fixed canvas (about 2400×1600) inside a pannable, zoomable viewport. Keep the starter shell working — drag-free scrolling pans the board, Ctrl+wheel and the zoom controls scale it, and the board content sits inside the canvas element so it moves together.',
    'Arrange sticky notes, frames, arrows and short labels as inline HTML with positioned blocks; short text only. Do not build a marketing page or navigation.',
  ],
};

export function designPrompt(input: DesignPromptInput): string {
  const folder = `${DESIGN_ROOT}/${input.slug}`;
  const brief = `${folder}/${DESIGN_BRIEF}`;
  const existing = input.existing.length ? input.existing.join(', ') : DESIGN_ENTRY;
  const kindRules = input.kind && input.kind !== 'page' ? KIND_RULES[input.kind] : [];
  const check = input.previewUrl
    ? `The live preview is served at ${input.previewUrl}/${input.slug}/${DESIGN_ENTRY}. Open it in the browser tool at 1440 wide and at 390 wide and look at every screen. Read the console for errors, click through every navigation link, and confirm each link opens the page it names. Fix what you see — overflow, overlap, cramped spacing, weak hierarchy, low contrast — then open it again and confirm the fix. A page you have not looked at is not finished.`
    : 'Use the browser tool to open the preview at 1280 wide and at 390 wide, and to look at every screen. Fix what you see: overflow, overlap, cramped spacing, weak hierarchy, low contrast. Click through every navigation link and confirm it opens the page it names.';
  if (input.revision) {
    return [
      `You are the design lead for ${input.projectName}. Revise the existing design in ${folder}/ (${existing}).`,
      `Read ${brief} and every current file in the folder before editing, then make targeted edits that keep the direction from the brief intact unless the request changes it.`,
      'Keep the preview offline: no CDN links, no web fonts, no network requests. Use system font stacks and inline SVG; keep every asset in the folder with relative links.',
      '',
      `Tokens (every color, font, size, space, radius and shadow comes from these; do not invent a second palette): :root{${designCssVariables(input.system)}}`,
      ...(input.system.notes.trim() ? ['Design notes:', input.system.notes.trim()] : []),
      ...(kindRules.length ? ['', ...kindRules] : []),
      '',
      'Request:',
      input.request.trim(),
      '',
      '## Check the result before you reply',
      check,
      'Then reply with two or three sentences on what you changed — no code dumps.',
    ].join('\n');
  }
  const lines = [
    `You are the design lead for ${input.projectName}. Build a web design that looks like a professional studio made it — not a page generator's first draft.`,
    '',
    `Write only inside ${folder}/. The entry file is ${folder}/${DESIGN_ENTRY}; keep every asset (CSS, JS, images) in that folder and link it relatively. The preview runs offline: no CDN links, no web fonts, no network requests. Use system font stacks and inline SVG.`,
    '',
    '## 1. Decide the direction before you write code',
    input.revision
      ? `Revise the existing design (${existing}). Read ${brief} and every current file in the folder before editing, then make targeted edits that keep the direction intact.`
      : `Create the page from scratch. Write ${brief} before you touch any HTML or CSS.`,
    `The brief records: the subject, audience and the page's single job; a palette of 4–6 named hex values mapped onto the tokens below; a display, body and utility face from system stacks with a type scale derived from --ds-base and --ds-scale; the layout concept; the signature element this design will be remembered by; one deliberate aesthetic risk; and the list of screens with their file names.`,
    'Avoid the defaults AI designs fall into unless the request asks for them: warm cream with a serif and terracotta; near-black with one acid accent; broadsheet hairlines everywhere. Spend boldness in one place — the signature element — and keep everything around it quiet and disciplined.',
    'Build to the brief exactly. Do not change the direction between iterations unless the request asks for it; when it does, update the brief in the same turn.',
    '',
    `## 2. The project design system (${input.system.name})`,
    `:root{${designCssVariables(input.system)}}`,
    'Every color, font, size, space, radius and shadow comes from these tokens (--ds-*). Do not invent a second palette or a parallel spacing scale.',
    ...(input.system.notes.trim() ? ['', 'Design notes:', input.system.notes.trim()] : []),
    '',
    '## 3. Build complete files',
    ...(kindRules.length
      ? ['Keep the work in index.html plus a shared styles.css; app.js only when behavior needs it. Write complete files in single writes — never truncate, never leave TODO or placeholder markup, never leave a broken intermediate draft.']
      : [
        'Split the work: one HTML file per screen (index.html plus about.html, pricing.html and so on), one shared styles.css, and app.js only when behavior needs it. Five complete small files are better than one huge file written in pieces.',
        'Navigation uses relative links only (href="pricing.html"). Never root-absolute (/pricing.html) or absolute URLs for internal navigation, and no target="_blank" for internal links. Every link must open a file that exists, and every screen needs the same navigation.',
        'Write complete files in single writes. Never truncate, never leave TODO or placeholder markup, never leave a broken intermediate draft — each write leaves the folder working.',
      ]),
    'Real content, not lorem ipsum: write the actual headings, body copy, prices, labels and empty states the subject needs.',
    ...(kindRules.length
      ? []
      : ['Craft floor: responsive at 1440, 900 and 390 with no horizontal scrolling and no overlapping navigation or footer links; hover and focus-visible states on every control; readable line length around 65ch; generous whitespace; motion only where it serves the page and reduced motion respected.']),
    ...(kindRules.length ? ['', ...kindRules] : []),
    '',
    'Request:',
    input.request.trim(),
    '',
    '## 4. Check the result before you reply',
    check,
    'Then reply with two or three sentences on what you changed — no code dumps.',
  ];
  return lines.join('\n');
}

/** The text the person typed, recovered from the scaffold a design turn adds around it. */
export function rawDesignRequest(prompt: string): string {
  const text = prompt.trim();
  const marker = '\nRequest:\n';
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const after = text.slice(start + marker.length);
  const end = after.search(/\n\n## (?:\d+\.\s*)?Check the result/);
  return (end < 0 ? after : after.slice(0, end)).trim() || text;
}

/** A same-design preview URL from a navigation message, or null when it is not this design. */
export function sameDesignURL(value: unknown, slug: string): string | null {
  if (typeof value !== 'string' || !isDesignSlug(slug) || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'relay-design:' || url.host !== 'preview' || url.username || url.password) return null;
  if (url.pathname.includes('%') || !url.pathname.endsWith('.html')) return null;
  const [first, ...rest] = url.pathname.split('/').filter(Boolean);
  if (first !== slug || !rest.length || rest.some((part) => part === '.' || part === '..')) return null;
  return `relay-design://preview/${slug}/${rest.join('/')}${url.hash}`;
}

export function previewScroll(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1_000_000, Math.max(0, Math.floor(number))) : 0;
}

export interface PickedElement {
  /** Chip title in the composer. */
  label: string;
  /** Everything the agent needs to find and change the element. */
  text: string;
}

/** Reads an untrusted picker payload from the preview into a safe context block. */
export function pickedElement(value: unknown): PickedElement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = (input: unknown, limit: number): string => typeof input === 'string'
    ? input.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
  const tag = typeof raw.tag === 'string' ? raw.tag.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return undefined;
  const selector = typeof raw.selector === 'string'
    ? raw.selector.replace(/[\u0000-\u001f\u007f<]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';
  const className = text(raw.classes, 120).split(' ').find((name) => /^[A-Za-z0-9_-]{1,40}$/.test(name));
  const content = text(raw.text, 160);
  const size = (input: unknown): number => {
    const number = typeof input === 'number' ? input : Number(input);
    return Number.isFinite(number) ? Math.min(10_000, Math.max(0, Math.round(number))) : 0;
  };
  const styles: string[] = [];
  if (raw.styles && typeof raw.styles === 'object' && !Array.isArray(raw.styles)) {
    for (const [property, entry] of Object.entries(raw.styles as Record<string, unknown>)) {
      if (styles.length >= 8) break;
      if (!/^[a-zA-Z-]{1,30}$/.test(property)) continue;
      const setting = text(entry, 120);
      if (setting) styles.push(`${property}: ${setting}`);
    }
  }
  const lines: string[] = [];
  if (selector) lines.push(`Selector: ${selector}`);
  lines.push(`Tag: ${tag}${className ? `.${className}` : ''}`);
  if (content) lines.push(`Text: “${content}”`);
  lines.push(`Size: ${size(raw.width)}×${size(raw.height)}`);
  if (styles.length) lines.push(`Styles: ${styles.join('; ')}`);
  return { label: `Element ${tag}${className ? `.${className}` : ''}`.slice(0, 120), text: lines.join('\n') };
}

export interface DesignSuggestionInput {
  /** Versions saved so far; the starter page counts as one. */
  versions: number;
  /** Context notes or picked elements riding with the next turn. */
  context: number;
}

/** Three refinement prompts that fit where the design currently stands. */
export function designSuggestions(input: DesignSuggestionInput): string[] {
  const refine = input.versions > 1
    ? [
      'Polish spacing, type hierarchy and contrast without changing the direction',
      'Add hover, focus, disabled and loading states to every control',
      'Add a second screen that reuses this navigation and layout',
    ]
    : [
      'Add a matching mobile layout for this page',
      'Add empty and error states for the main action',
      'Add a second screen that shares this style and navigation',
    ];
  const focused = input.context > 0
    ? 'Rework the attached context: tighten its spacing, strengthen the hierarchy and keep the direction'
    : '';
  return [focused, ...refine].filter(Boolean).slice(0, 3);
}

export const PREVIEW_RUNTIME_ID = 'relay-preview-runtime';

const PREVIEW_RUNTIME = [
  '<style id="relay-preview-motion">@view-transition{navigation:auto}',
  '@media (prefers-reduced-motion:no-preference){::view-transition-old(root),::view-transition-new(root){animation-duration:.16s}}</style>',
  '<style id="relay-pick-style">#relay-pick-box{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #6c8cff;border-radius:4px;background:rgba(108,140,255,.10);display:none}#relay-pick-box[data-picking="true"]{border-style:dashed}#relay-pick-tag{position:fixed;z-index:2147483647;pointer-events:none;display:none;max-width:70vw;padding:2px 7px;border-radius:4px;background:rgba(11,16,32,.9);color:#e6ebff;font:11px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>',
  '<style id="relay-edit-style">html{cursor:text}body[contenteditable="true"]{outline:none}</style>',
  '<script id="relay-preview-runtime">(function(){',
  'if(window.__relayPreviewRuntime)return;window.__relayPreviewRuntime=true;',
  'var last=0,picking=false,selected=null,editing=false;',
  'function send(){try{parent.postMessage({relayPreview:1,href:location.href,scrollY:Math.round(window.scrollY||0)},"*")}catch(e){}}',
  'function box(){var el=document.getElementById("relay-pick-box");if(!el){el=document.createElement("div");el.id="relay-pick-box";document.documentElement.appendChild(el)}return el}',
  'function tag(){var el=document.getElementById("relay-pick-tag");if(!el){el=document.createElement("div");el.id="relay-pick-tag";document.documentElement.appendChild(el)}return el}',
  'function part(el){var c=(el.getAttribute("class")||"").trim().split(/\\s+/).filter(function(v){return /^[A-Za-z0-9_-]+$/.test(v)}).slice(0,2);return el.tagName.toLowerCase()+(c.length?"."+c.join("."):"")}',
  'function selector(el){var out=[];while(el&&el.nodeType===1&&el.tagName.toLowerCase()!=="html"&&out.length<6){if(el.id&&/^[A-Za-z][\\w-]*$/.test(el.id)){out.unshift(el.tagName.toLowerCase()+"#"+el.id);break}var same=1,p=el;while((p=p.previousElementSibling)){if(p.tagName===el.tagName)same++}out.unshift(part(el)+(same>1?":nth-of-type("+same+")":""));el=el.parentElement}return out.join(" > ")}',
  'function place(el){var r=el.getBoundingClientRect(),b=box(),t=tag();b.style.display="block";b.style.left=r.left+"px";b.style.top=r.top+"px";b.style.width=Math.max(0,r.width)+"px";b.style.height=Math.max(0,r.height)+"px";t.style.display="block";t.textContent=part(el)+"  "+Math.round(r.width)+"\\u00d7"+Math.round(r.height);t.style.left=Math.max(4,r.left)+"px";t.style.top=Math.max(4,r.top-22)+"px"}',
  'function hide(){box().style.display="none";tag().style.display="none"}',
  'function describe(el){var cs=getComputedStyle(el),keep={},keys=["font-family","font-size","font-weight","line-height","letter-spacing","color","background-color","border-radius","padding","display","gap","max-width"],i,v;for(i=0;i<keys.length;i++){v=cs.getPropertyValue(keys[i]);if(v&&v.length<120)keep[keys[i]]=v}var r=el.getBoundingClientRect();return{selector:selector(el),tag:el.tagName.toLowerCase(),classes:(el.getAttribute("class")||"").slice(0,120),text:(el.textContent||"").replace(/\\s+/g," ").trim().slice(0,160),width:r.width,height:r.height,styles:keep}}',
  'function end(clear){picking=false;window.removeEventListener("mousemove",hover,true);window.removeEventListener("click",pick,true);window.removeEventListener("keydown",escape,true);document.documentElement.style.cursor="";var b=box();b.removeAttribute("data-picking");if(clear){selected=null;hide()}else if(selected){b.setAttribute("data-picking","false");place(selected)}}',
  'function hover(e){var el=document.elementFromPoint(e.clientX,e.clientY);if(!el||el.id==="relay-pick-box"||el.id==="relay-pick-tag")return;selected=el;place(el)}',
  'function pick(e){if(!picking)return;var el=document.elementFromPoint(e.clientX,e.clientY);if(!el)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();var payload=describe(el);end(false);try{parent.postMessage({relayPicked:1,element:payload},"*")}catch(err){}}',
  'function escape(e){if(e.key!=="Escape")return;e.preventDefault();e.stopPropagation();end(true);try{parent.postMessage({relayPickEnded:1},"*")}catch(err){}}',
  'function start(){if(picking)return;if(editing)editStop();picking=true;selected=null;hide();box().setAttribute("data-picking","true");window.addEventListener("mousemove",hover,true);window.addEventListener("click",pick,true);window.addEventListener("keydown",escape,true);document.documentElement.style.cursor="crosshair"}',
  'function stripRoot(root){var nodes=root.querySelectorAll("script[id^=\'relay-\'],style[id^=\'relay-\'],div[id^=\'relay-pick\']");for(var i=nodes.length-1;i>=0;i--){if(nodes[i].parentNode)nodes[i].parentNode.removeChild(nodes[i])}var editable=root.querySelectorAll("[contenteditable]");for(var j=0;j<editable.length;j++)editable[j].removeAttribute("contenteditable");var body=root.querySelector("body");if(body){body.classList.remove("relay-editing");if(!body.getAttribute("class"))body.removeAttribute("class")}}',
  'function serialize(){var clone=document.documentElement.cloneNode(true);stripRoot(clone);return "<!doctype html>\\n"+clone.outerHTML}',
  'function editDirty(){try{parent.postMessage({relayDirty:1},"*")}catch(err){}}',
  'function editClick(e){var target=e.target;if(target&&target.closest&&target.closest("a[href]"))e.preventDefault()}',
  'function editBlock(e){e.preventDefault()}',
  'function editKeys(e){if(e.key==="Escape"){e.preventDefault();e.stopPropagation();if(editStop()){try{parent.postMessage({relayEditEnded:1},"*")}catch(err){}}}else if((e.metaKey||e.ctrlKey)&&(e.key==="s"||e.key==="S")){e.preventDefault();try{parent.postMessage({relaySaveRequest:1},"*")}catch(err){}}}',
  'function editStop(){if(!editing)return false;editing=false;var body=document.body;if(body)body.removeAttribute("contenteditable");window.removeEventListener("click",editClick,true);window.removeEventListener("submit",editBlock,true);window.removeEventListener("keydown",editKeys,true);window.removeEventListener("input",editDirty,true);return true}',
  'function editStart(){if(editing)return;end(true);var body=document.body;if(!body)return;editing=true;body.setAttribute("contenteditable","true");window.addEventListener("click",editClick,true);window.addEventListener("submit",editBlock,true);window.addEventListener("keydown",editKeys,true);window.addEventListener("input",editDirty,true)}',
  'function editSave(){if(!editing)return;var html=serialize();editStop();try{parent.postMessage({relayEdited:1,html:html},"*")}catch(err){}}',
  'function onScroll(){if(!picking&&selected)place(selected);var now=Date.now();if(now-last<150)return;last=now;send()}',
  'window.addEventListener("load",send);',
  'window.addEventListener("scroll",onScroll,{passive:true});',
  'window.addEventListener("resize",function(){if(selected)place(selected)});',
  'window.addEventListener("message",function(event){var data=event.data;if(!data)return;',
  'if(typeof data.relayPreviewScroll==="number"){requestAnimationFrame(function(){window.scrollTo(0,data.relayPreviewScroll)});return}',
  'if(data.relayPick==="start"){start()}else if(data.relayPick==="stop"){end(true)}else if(data.relayPick==="clear"){selected=null;hide()}',
  'if(data.relayEdit==="start"){editStart()}else if(data.relayEdit==="stop"){editStop()}else if(data.relayEdit==="save"){editSave()}});',
  'send();',
  '})();</script>',
].join('');

/** Adds the navigation/scroll runtime to a page on its way out of the preview server. */
export function injectPreviewRuntime(html: string): string {
  if (html.includes(PREVIEW_RUNTIME_ID)) return html;
  const body = html.lastIndexOf('</body>');
  if (body !== -1) return `${html.slice(0, body)}${PREVIEW_RUNTIME}${html.slice(body)}`;
  return `${html}${PREVIEW_RUNTIME}`;
}

export function implementPrompt(input: { slug: string; title: string }): string {
  return [
    `Implement the approved design "${input.title}" from ${DESIGN_ROOT}/${input.slug}/ in this project.`,
    '',
    `1. Read ${DESIGN_ROOT}/${input.slug}/${DESIGN_ENTRY} and its assets, and ${DESIGN_SYSTEM_FILE}.`,
    '2. Find where this page belongs in the project (existing routes, components, styles) and follow the project conventions.',
    '3. Translate the design faithfully, keeping the design-system tokens rather than hard-coded values.',
    '4. Wire it into navigation if the project has one, and verify it builds.',
    '',
    'Reply with the files you changed and anything you had to adapt.',
  ].join('\n');
}
