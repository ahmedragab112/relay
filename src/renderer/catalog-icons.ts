// Themed SVG icons for the Toolkit catalogs: skills map by category, plugins and
// connectors by name keywords. Pure spec functions are unit-testable; the element
// builder mirrors file-icons.ts so pages render icons without any image assets.

export type CatalogIconKind =
  | 'code' | 'layout' | 'device' | 'braces' | 'spark' | 'database' | 'cloud'
  | 'shield' | 'pen' | 'flow' | 'react' | 'git' | 'rocket' | 'chat'
  | 'globe' | 'plug' | 'kit';

export interface CatalogIconSpec {
  kind: CatalogIconKind;
  color: string;
}

const COLORS: Record<CatalogIconKind, string> = {
  code: '#519aba',
  layout: '#ec407a',
  device: '#7986cb',
  braces: '#cbcb41',
  spark: '#a074c4',
  database: '#26a69a',
  cloud: '#66bb6a',
  shield: '#ef5350',
  pen: '#5c6bc0',
  flow: '#90a4ae',
  react: '#53bde7',
  git: '#e37933',
  rocket: '#ff7043',
  chat: '#4dd0e1',
  globe: '#42a5f5',
  plug: '#7986cb',
  kit: '#90a4ae',
};

const SKILL_CATEGORIES: Record<string, CatalogIconKind> = {
  Engineering: 'code',
  Frontend: 'layout',
  'Mobile & desktop': 'device',
  Languages: 'braces',
  'Data & AI': 'spark',
  'Backend & data': 'database',
  DevOps: 'cloud',
  'Testing & security': 'shield',
  'Product & writing': 'pen',
  Workflow: 'flow',
};

// First matching rule wins, so families are ordered from specific to general.
const PLUGIN_RULES: Array<[RegExp, CatalogIconKind]> = [
  [/react|next|remix/, 'react'],
  [/\bios\b|android|flutter|\brn\b|mobile|desktop|electron|push/, 'device'],
  [/git/, 'git'],
  [/docker|kubernetes|nginx|terraform|cloud|linux|monitor|observab|sre|supply|backup/, 'cloud'],
  [/auth|secret|security|threat|pentest|privacy|compliance|audit/, 'shield'],
  [/test|\bqa\b|eval/, 'shield'],
  [/\bml\b|machine|pandas|analytics|data|warehouse|etl|metrics|viz|experiment/, 'spark'],
  [/sql|postgres|cache|queue/, 'database'],
  [/release|\bci\b|deploy|migration/, 'rocket'],
  [/css|style|design|animation|a11y|accessib/, 'layout'],
  [/\bapi\b|graphql|grpc|websocket|microservice|deeplink|offline|code/, 'code'],
  [/docs|blog|story|brief|prd|knowledge|changelog|editing|translation|seo|social|feedback|email|hiring|estimation|pricing|retro|onboarding|incident|triage|planning|roadmap|handoff|review|adr|automation|notebook|prompt|dependency|refactor|performance|debugging|forms|knowledge/, 'pen'],
];

const CONNECTOR_RULES: Array<[RegExp, CatalogIconKind]> = [
  [/git/, 'git'],
  [/slack|discord|telegram|whatsapp|chat|teams|zoom|twilio|gmail|mail|calendar|outlook/, 'chat'],
  [/postgres|mysql|sqlite|mongo|redis|elasticsearch|snowflake|bigquery|clickhouse|supabase|database/, 'database'],
  [/cloudflare|vercel|netlify|\baws\b|azure|digitalocean|terraform|kubernetes|docker/, 'cloud'],
  [/search|brave|exa|tavily|perplexity|wikipedia|reddit|youtube|arxiv|pubmed|maps|duckduckgo|firecrawl|searx|jina|hacker/, 'globe'],
  [/figma|canva|miro|design|blender/, 'layout'],
];

export function skillIcon(category: string): CatalogIconSpec {
  const kind = SKILL_CATEGORIES[category.trim()] ?? 'kit';
  return { kind, color: COLORS[kind] };
}

export function pluginIcon(name: string): CatalogIconSpec {
  const lower = name.toLowerCase();
  for (const [pattern, kind] of PLUGIN_RULES) {
    if (pattern.test(lower)) return { kind, color: COLORS[kind] };
  }
  return { kind: 'kit', color: COLORS.kit };
}

export function connectorIcon(name: string, type: 'local' | 'remote'): CatalogIconSpec {
  const lower = name.toLowerCase();
  for (const [pattern, kind] of CONNECTOR_RULES) {
    if (pattern.test(lower)) return { kind, color: COLORS[kind] };
  }
  return { kind: 'plug', color: COLORS.plug };
}

const GLYPH = (inner: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${inner}</svg>`;

const ATOM = (color: string) =>
  GLYPH(`<circle cx="8" cy="8" r="1.2" fill="${color}"/><g fill="none" stroke="${color}" stroke-width=".95"><ellipse cx="8" cy="8" rx="6" ry="2.4"/><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(60 8 8)"/><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(120 8 8)"/></g>`);
const BRANCH = (color: string) =>
  GLYPH(`<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"><circle cx="5" cy="3.6" r="1.5"/><circle cx="5" cy="12.4" r="1.5"/><circle cx="11.2" cy="5.6" r="1.5"/><path d="M5 5.1v5.8M11.2 7.1c0 2.5-2.2 3.2-4.6 3.6"/></g>`);

const GLYPHS: Record<CatalogIconKind, (color: string) => string> = {
  code: (color) => GLYPH(`<path d="M5.8 4.6 2.9 8l2.9 3.4M10.2 4.6 13.1 8l-2.9 3.4" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`),
  layout: (color) => GLYPH(`<rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.2" fill="none" stroke="${color}" stroke-width="1.1"/><path d="M2.4 6.4h11.2M7.2 6.4v6.4" fill="none" stroke="${color}" stroke-width="1.1"/>`),
  device: (color) => GLYPH(`<rect x="4.6" y="2.2" width="6.8" height="11.6" rx="1.3" fill="none" stroke="${color}" stroke-width="1.1"/><path d="M7 12.2h2" stroke="${color}" stroke-width="1.1" stroke-linecap="round"/>`),
  braces: (color) => GLYPH(`<text x="8" y="10.6" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="6.8" font-weight="700" fill="${color}">{ }</text>`),
  spark: (color) => GLYPH(`<path d="M8 2.2l1.5 4.3L13.8 8l-4.3 1.5L8 13.8 6.5 9.5 2.2 8l4.3-1.5z" fill="${color}" fill-opacity=".9"/>`),
  database: (color) => GLYPH(`<g fill="none" stroke="${color}" stroke-width="1.1"><ellipse cx="8" cy="4.4" rx="5.2" ry="2"/><path d="M2.8 4.4v7.2c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V4.4"/><path d="M2.8 8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2"/></g>`),
  cloud: (color) => GLYPH(`<path d="M4.8 12.6a3 3 0 0 1-.4-6A4 4 0 0 1 12.1 7.4a2.6 2.6 0 0 1-.5 5.2z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>`),
  shield: (color) => GLYPH(`<path d="M8 2.2l4.8 1.8v4.2c0 3-2 4.9-4.8 5.9-2.8-1-4.8-2.9-4.8-5.9V4z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 7.8l1.5 1.6L10.3 6" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  pen: (color) => GLYPH(`<path d="M10.8 2.9l2.3 2.3-7.4 7.4-3 .7.7-3z" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/><path d="M9.6 4.1l2.3 2.3" stroke="${color}" stroke-width="1.1"/>`),
  flow: (color) => GLYPH(`<g fill="none" stroke="${color}" stroke-width="1.1"><circle cx="4" cy="4.4" r="1.7"/><circle cx="12" cy="11.6" r="1.7"/><path d="M5.2 5.9c2.4 1.1 3.5 2.6 4.9 4.6" stroke-linecap="round"/></g>`),
  react: ATOM,
  git: BRANCH,
  rocket: (color) => GLYPH(`<path d="M8 2.6c1.6 1.3 2.4 3 2.4 4.9L9 9.4H7L5.6 7.5c0-1.9.8-3.6 2.4-4.9z" fill="${color}" fill-opacity=".9"/><path d="M7 9.4 5.2 11.6h5.6L9 9.4" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/><path d="M8 11.6v2.2" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`),
  chat: (color) => GLYPH(`<path d="M13.2 9.2c0 .8-.6 1.4-1.4 1.4H7.6L4.4 13v-2.4h-.2c-.8 0-1.4-.6-1.4-1.4V4.4c0-.8.6-1.4 1.4-1.4h7.6c.8 0 1.4.6 1.4 1.4z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>`),
  globe: (color) => GLYPH(`<g fill="none" stroke="${color}" stroke-width="1.1"><circle cx="8" cy="8" r="5.4"/><ellipse cx="8" cy="8" rx="2.4" ry="5.4"/><path d="M2.6 8h10.8"/></g>`),
  plug: (color) => GLYPH(`<g fill="none" stroke="${color}" stroke-linecap="round"><path d="M5.4 2.6v3M10.6 2.6v3" stroke-width="1.3"/><path d="M3.8 5.6h8.4v2.8a4.2 4.2 0 0 1-8.4 0z" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 12.6v1.4" stroke-width="1.2"/></g>`),
  kit: (color) => GLYPH(`<path d="M6.2 3.4h3.6v1.4c0 .6.5 1.1 1.1 1.1h1.7v3.6h-1.7c-.6 0-1.1.5-1.1 1.1v1.4H6.2v-1.4c0-.6-.5-1.1-1.1-1.1H3.4V5.9h1.7c.6 0 1.1-.5 1.1-1.1z" fill="${color}" fill-opacity=".9"/>`),
};

export function catalogIconElement(spec: CatalogIconSpec): HTMLElement {
  const element = document.createElement('span');
  element.className = 'catalog-icon';
  element.innerHTML = GLYPHS[spec.kind](spec.color);
  return element;
}
