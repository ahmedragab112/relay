/** Design: pages built in a project sandbox at .relay/design, styled by .relay/design-system.json. */

export const DESIGN_ROOT = '.relay/design';
export const DESIGN_SYSTEM_FILE = '.relay/design-system.json';
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

export interface DesignEntry {
  slug: string;
  title: string;
  updatedAt: number;
  versions: number;
  /** The visible engine task behind this design's iterations. */
  sessionId?: string;
  /** Model chosen for this design's turns; absent means Auto. */
  model?: string;
}

export interface DesignVersion {
  version: number;
  savedAt: number;
}

export interface DesignView {
  designs: DesignEntry[];
  system: DesignSystem;
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
}

export function designPrompt(input: DesignPromptInput): string {
  const folder = `${DESIGN_ROOT}/${input.slug}`;
  const brief = `${folder}/${DESIGN_BRIEF}`;
  const existing = input.existing.length ? input.existing.join(', ') : DESIGN_ENTRY;
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
    'Split the work: one HTML file per screen (index.html plus about.html, pricing.html and so on), one shared styles.css, and app.js only when behavior needs it. Five complete small files are better than one huge file written in pieces.',
    'Navigation uses relative links only (href="pricing.html"). Never root-absolute (/pricing.html) or absolute URLs for internal navigation, and no target="_blank" for internal links. Every link must open a file that exists, and every screen needs the same navigation.',
    'Write complete files in single writes. Never truncate, never leave TODO or placeholder markup, never leave a broken intermediate draft — each write leaves the folder working.',
    'Real content, not lorem ipsum: write the actual headings, body copy, prices, labels and empty states the subject needs.',
    'Craft floor: responsive at 1440, 900 and 390 with no horizontal scrolling and no overlapping navigation or footer links; hover and focus-visible states on every control; readable line length around 65ch; generous whitespace; motion only where it serves the page and reduced motion respected.',
    '',
    'Request:',
    input.request.trim(),
    '',
    '## 4. Check the result before you reply',
    'Use the browser tool to open the preview at 1280 wide and at 390 wide, and to look at every screen. Fix what you see: overflow, overlap, cramped spacing, weak hierarchy, low contrast. Click through every navigation link and confirm it opens the page it names. Then reply with two or three sentences on what you changed — no code dumps.',
  ];
  return lines.join('\n');
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

export const PREVIEW_RUNTIME_ID = 'relay-preview-runtime';

const PREVIEW_RUNTIME = [
  '<style id="relay-preview-motion">@view-transition{navigation:auto}',
  '@media (prefers-reduced-motion:no-preference){::view-transition-old(root),::view-transition-new(root){animation-duration:.16s}}</style>',
  '<script id="relay-preview-runtime">(function(){',
  'if(window.__relayPreviewRuntime)return;window.__relayPreviewRuntime=true;',
  'var last=0;',
  'function send(){try{parent.postMessage({relayPreview:1,href:location.href,scrollY:Math.round(window.scrollY||0)},"*")}catch(e){}}',
  'function onScroll(){var now=Date.now();if(now-last<150)return;last=now;send()}',
  'window.addEventListener("load",send);',
  'window.addEventListener("scroll",onScroll,{passive:true});',
  'window.addEventListener("message",function(event){var data=event.data;',
  'if(!data||typeof data.relayPreviewScroll!=="number")return;',
  'requestAnimationFrame(function(){window.scrollTo(0,data.relayPreviewScroll)})});',
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
