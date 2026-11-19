// Pure helpers behind the Toolkit discovery layout: plugin families, the
// headline, and the filtered section grouping shared by all three tabs.

export const ALL_FILTER = 'All';
export const INSTALLED_FILTER = 'Installed';

export interface DiscoveryItem {
  id: string;
  name: string;
  description: string;
  family: string;
  installed: boolean;
  /** Part of the bundled catalog; false for things added from a file or URL. */
  bundled: boolean;
  /** Extra chip labels this item belongs to, e.g. Remote or Enabled. */
  tags?: string[];
}

export function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => (value ?? '').toLowerCase().includes(needle));
}

export interface DiscoverySection {
  title: string;
  items: DiscoveryItem[];
}

export interface DiscoveryLayout {
  chips: string[];
  headline: string;
  sections: DiscoverySection[];
}

// Ordered from specific to general, same idea as the icon rules.
const PLUGIN_FAMILIES: Array<[RegExp, string]> = [
  [/react|next|remix|css|style|design|animation|a11y|accessib|frontend/, 'Frontend'],
  [/\bios\b|android|flutter|\brn\b|mobile|desktop|electron|push/, 'Mobile & desktop'],
  [/test|\bqa\b|eval|auth|secret|security|threat|pentest|privacy|compliance|audit/, 'Testing & security'],
  [/kubernetes|docker|terraform|nginx|cloud|linux|monitor|observab|\bsre\b|deploy|release|\bci\b|backup|supply/, 'DevOps'],
  [/\bml\b|machine|pandas|analytics|\bai\b|data|warehouse|etl|metrics|viz|experiment|notebook/, 'Data & AI'],
  [/sql|postgres|cache|queue|\bapi\b|graphql|grpc|websocket|microservice/, 'Backend & data'],
  [/git|review|planning|onboarding|automation|dependency|refactor|debugging|performance/, 'Workflow'],
];

const FALLBACK_FAMILY = 'Product & writing';

export function pluginFamily(name: string): string {
  const lower = name.toLowerCase();
  for (const [pattern, family] of PLUGIN_FAMILIES) {
    if (pattern.test(lower)) return family;
  }
  return FALLBACK_FAMILY;
}

export function discoveryHeadline(families: string[]): string {
  if (!families.length) return 'Nothing here yet';
  const [first, second, third, ...rest] = families;
  if (!second) return `With ${first}`;
  if (!third) return `With ${first} and ${second}`;
  if (!rest.length) return `With ${first}, ${second} and ${third}`;
  return `With ${first}, ${second}, ${third} and ${rest.length} more`;
}

export function discoveryLayout(
  items: DiscoveryItem[],
  filter: string,
  query: string,
  extras: string[] = [],
): DiscoveryLayout {
  const families: string[] = [];
  for (const entry of items) {
    if (entry.bundled && !families.includes(entry.family)) families.push(entry.family);
  }
  const chips = [ALL_FILTER, INSTALLED_FILTER, ...families, ...extras];
  const headline = discoveryHeadline(families);
  const visible = items.filter((entry) => {
    if (filter === INSTALLED_FILTER) return entry.installed;
    if (!entry.bundled) return false;
    if (extras.includes(filter)) return (entry.tags ?? []).includes(filter);
    return filter === ALL_FILTER || entry.family === filter;
  }).filter((entry) => matchesQuery(query, entry.name, entry.description, entry.family));

  if (filter === INSTALLED_FILTER) {
    return { chips, headline, sections: visible.length ? [{ title: INSTALLED_FILTER, items: visible }] : [] };
  }
  if (filter !== ALL_FILTER) {
    return { chips, headline, sections: visible.length ? [{ title: filter, items: visible }] : [] };
  }
  const sections = families
    .map((title) => ({ title, items: visible.filter((entry) => entry.family === title) }))
    .filter((section) => section.items.length > 0);
  return { chips, headline, sections };
}