import type {
  ActivityArtifact, ActivityChatMessage, ActivityFileSource, ActivityMcp, ActivityMcpSuggestion,
  ActivitySkill, ActivitySkillSuggestion, ActivitySourceKind, ActivitySubagent, ActivityWebSource,
  McpServer, SessionActivity, SkillOption, SkillRegistryEntry,
} from '../shared/contracts.js';

export interface ActivityMessageInput {
  type: string;
  id: string;
  time?: { created: number };
  text?: string;
  name?: string;
  skill?: string;
  files?: Array<{ name?: string; source?: { type: string; uri?: string } }>;
  skills?: Array<{ id: string; name: string }>;
  content?: Array<{
    type: string;
    id?: string;
    text?: string;
    name?: string;
    state?: { status?: string; input?: unknown };
  }>;
}

export interface ActivitySubagentInput {
  id: string;
  childSessionID: string;
  agent: string;
  description: string;
  title?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  time: { started: number; completed?: number };
  messages: ActivityMessageInput[];
}

export interface ActivityChildSessionInput {
  id: string;
  agent?: string;
  title?: string;
  status: 'running' | 'completed';
  time: { created: number; updated: number };
  messages: ActivityMessageInput[];
}

export interface ActivityArtifactInput {
  id: string;
  title: string;
  provider: string;
  entry: string;
  url: string;
  time: { created: number; updated: number };
}

export interface ActivityInput {
  sessionId: string;
  messages: ActivityMessageInput[];
  subagents: ActivitySubagentInput[];
  childSessions?: ActivityChildSessionInput[];
  artifacts: ActivityArtifactInput[];
  skills: SkillOption[];
  webSkills?: SkillRegistryEntry[];
  mcp: McpServer[];
  taskText: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'was', 'has', 'have',
  'add', 'use', 'using', 'our', 'can', 'will', 'not', 'but', 'all', 'any', 'how', 'why', 'when', 'what',
  'make', 'just', 'need', 'want', 'help', 'app', 'code', 'task', 'chat', 'work', 'working', 'file', 'files',
]);

const SYNONYMS: Record<string, string[]> = {
  test: ['test', 'testing', 'review', 'verify', 'qa'],
  review: ['review', 'audit', 'qa', 'verify'],
  browser: ['browser', 'chrome', 'devtools', 'playwright'],
  web: ['web', 'browser', 'fetch', 'search'],
  search: ['search', 'grep', 'websearch'],
  design: ['design', 'ui', 'ux', 'figma'],
  pdf: ['pdf', 'document', 'docs'],
  docs: ['docs', 'document', 'pdf', 'markdown'],
  document: ['document', 'docs', 'pdf'],
  database: ['database', 'sql', 'sqlite', 'postgres'],
  deploy: ['deploy', 'release', 'ship'],
  release: ['release', 'deploy', 'ship'],
  git: ['git', 'github', 'branch'],
  github: ['github', 'git', 'branch'],
  image: ['image', 'screenshot', 'png'],
  screenshot: ['screenshot', 'image', 'ui'],
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp', 'tiff']);
const DOCUMENT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'rtf', 'doc', 'docx', 'pages', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'key', 'html', 'json']);

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

interface WordGroup { word: string; variants: string[] }

function groupsOf(text: string): WordGroup[] {
  const seen = new Set<string>();
  const groups: WordGroup[] = [];
  for (const word of wordsOf(text)) {
    if (word.length < 3 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    groups.push({ word, variants: [word, ...(SYNONYMS[word] ?? [])] });
  }
  return groups;
}

function scoreText(name: string, description: string, groups: WordGroup[]): { score: number; matched: string[] } {
  const nameWords = new Set(wordsOf(name));
  const descriptionWords = new Set(wordsOf(description));
  let score = 0;
  const matched: string[] = [];
  for (const group of groups) {
    if (group.variants.some((variant) => nameWords.has(variant))) {
      score += 3;
      matched.push(group.word);
    } else if (group.variants.some((variant) => descriptionWords.has(variant))) {
      score += 1;
      matched.push(group.word);
    }
  }
  return { score, matched };
}

const QODER_ONLY = /\bqoder\b[^.]{0,40}\b(?:tool|tools|only|desktop|app|cli)\b|\b(?:requires?|needs?|must use)\b[^.]{0,40}\bqoder\b/i;

function reasonText(matched: string[]): string {
  return `Matches “${matched[0]}”${matched.length > 1 ? ` +${matched.length - 1} more` : ''} in this task`;
}

function toolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mcpServerOf(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  const parts = toolName.split('__');
  return parts.length >= 3 && parts[1] ? parts[1] : undefined;
}

function basename(path: string): string {
  const trimmed = path.split(/[?#]/)[0].replace(/[\\/]+$/, '');
  const segment = trimmed.split(/[\\/]/).pop() ?? trimmed;
  try {
    return decodeURIComponent(segment) || segment;
  } catch {
    return segment;
  }
}

function sourceKind(path: string): ActivitySourceKind {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return 'file';
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function subagentChat(messages: ActivityMessageInput[]): ActivityChatMessage[] {
  const lines: ActivityChatMessage[] = [];
  for (const message of messages) {
    if (message.type === 'user' && message.text?.trim()) {
      lines.push({ id: message.id, role: 'user', text: clip(message.text.trim(), 2_000) });
      continue;
    }
    if (message.type === 'skill' && message.name) {
      lines.push({ id: message.id, role: 'assistant', text: `→ Skill: ${message.name}` });
      continue;
    }
    if (message.type !== 'assistant') continue;
    const parts = (message.content ?? []).flatMap((part) => {
      if (part.type === 'text' && part.text?.trim()) return [part.text.trim()];
      if (part.type === 'tool' && part.name) return [`→ ${part.name}`];
      return [];
    });
    if (parts.length) lines.push({ id: message.id, role: 'assistant', text: clip(parts.join('\n'), 2_000) });
  }
  return lines.slice(-30);
}

function usedSkills(messages: ActivityMessageInput[], catalog: SkillOption[]): ActivitySkill[] {
  const byId = new Map<string, { id: string; name: string; uses: number; lastUsed: number }>();
  const record = (id: string, name: string, at: number) => {
    const existing = byId.get(id);
    if (existing) existing.uses += 1;
    else byId.set(id, { id, name, uses: 1, lastUsed: at });
    const entry = byId.get(id)!;
    entry.lastUsed = Math.max(entry.lastUsed, at);
    if (name) entry.name = name;
  };
  for (const message of messages) {
    const at = message.time?.created ?? 0;
    if (message.type === 'skill' && message.skill) record(message.skill, message.name ?? message.skill, at);
    if (message.type === 'user') for (const skill of message.skills ?? []) record(skill.id, skill.name, at);
  }
  const descriptions = new Map<string, string>();
  for (const skill of catalog) {
    descriptions.set(skill.id, skill.description);
    descriptions.set(skill.name.toLowerCase(), skill.description);
  }
  return [...byId.values()].map((entry) => {
    const known = catalog.find((skill) => skill.id === entry.id || skill.name.toLowerCase() === entry.name.toLowerCase());
    return {
      id: entry.id,
      name: known?.name || entry.name,
      description: known?.description ?? descriptions.get(entry.id) ?? '',
      uses: entry.uses,
      lastUsed: entry.lastUsed,
    };
  }).sort((left, right) => right.lastUsed - left.lastUsed || right.uses - left.uses);
}

function usedMcp(messages: ActivityMessageInput[], configured: McpServer[]): ActivityMcp[] {
  const byName = new Map<string, { uses: number; lastUsed: number }>();
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    const at = message.time?.created ?? 0;
    for (const part of message.content ?? []) {
      if (part.type !== 'tool' || !part.name) continue;
      const server = mcpServerOf(part.name);
      if (!server) continue;
      const entry = byName.get(server) ?? { uses: 0, lastUsed: 0 };
      entry.uses += 1;
      entry.lastUsed = Math.max(entry.lastUsed, at);
      byName.set(server, entry);
    }
  }
  return [...byName.entries()].map(([name, entry]) => ({
    name,
    type: configured.find((server) => server.name === name)?.type ?? 'local',
    uses: entry.uses,
    lastUsed: entry.lastUsed,
  })).sort((left, right) => right.uses - left.uses || right.lastUsed - left.lastUsed);
}

function webSources(messages: ActivityMessageInput[]): ActivityWebSource[] {
  const byKey = new Map<string, ActivityWebSource>();
  const add = (key: string, create: () => ActivityWebSource, at: number) => {
    const existing = byKey.get(key);
    if (existing) {
      existing.mentions += 1;
      existing.lastUsed = Math.max(existing.lastUsed, at);
      return;
    }
    const created = create();
    created.mentions = 1;
    created.lastUsed = at;
    byKey.set(key, created);
  };
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    const at = message.time?.created ?? 0;
    for (const part of message.content ?? []) {
      if (part.type !== 'tool' || !part.name) continue;
      const name = part.name.toLowerCase();
      const input = toolInput(part.state?.input);
      if (name === 'webfetch' || name === 'web_fetch' || name === 'fetch') {
        const url = stringField(input, ['url', 'uri', 'link']);
        if (!url) continue;
        add(`fetch:${url}`, () => ({ id: `fetch:${url}`, kind: 'fetch', label: url, url, mentions: 0, lastUsed: 0 }), at);
      } else if (name === 'websearch' || name === 'web_search') {
        const query = stringField(input, ['query', 'q', 'search']);
        if (!query) continue;
        add(`search:${query.toLowerCase()}`, () => ({ id: `search:${query.toLowerCase()}`, kind: 'search', label: query, mentions: 0, lastUsed: 0 }), at);
      }
    }
  }
  return [...byKey.values()].sort((left, right) => right.lastUsed - left.lastUsed || right.mentions - left.mentions);
}

function fileSources(messages: ActivityMessageInput[]): ActivityFileSource[] {
  const byPath = new Map<string, ActivityFileSource>();
  const add = (path: string, at: number) => {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) return;
    const existing = byPath.get(normalized);
    if (existing) {
      existing.mentions += 1;
      existing.lastUsed = Math.max(existing.lastUsed, at);
      return;
    }
    byPath.set(normalized, { path: normalized, name: basename(normalized), kind: sourceKind(normalized), mentions: 1, lastUsed: at });
  };
  for (const message of messages) {
    const at = message.time?.created ?? 0;
    if (message.type === 'user') {
      for (const file of message.files ?? []) {
        const name = file.name?.trim() || (file.source?.uri ? basename(file.source.uri) : '');
        if (name) add(name, at);
      }
    }
    if (message.type !== 'assistant') continue;
    for (const part of message.content ?? []) {
      if (part.type !== 'tool' || !part.name) continue;
      if (!['read', 'readfile', 'read_file'].includes(part.name.toLowerCase())) continue;
      const path = stringField(toolInput(part.state?.input), ['path', 'filePath', 'file_path']);
      if (path) add(path, at);
    }
  }
  return [...byPath.values()].sort((left, right) => right.mentions - left.mentions || left.name.localeCompare(right.name));
}

function suggestedSkills(
  catalog: SkillOption[], web: SkillRegistryEntry[], used: ActivitySkill[], groups: WordGroup[],
): ActivitySkillSuggestion[] {
  const taken = new Set(used.flatMap((skill) => [skill.id.toLowerCase(), skill.name.toLowerCase()]));
  const installed = new Set(catalog.flatMap((skill) => [skill.id.toLowerCase(), skill.name.toLowerCase()]));
  const scored: Array<ActivitySkillSuggestion & { score: number }> = [];
  for (const skill of catalog) {
    if (taken.has(skill.id.toLowerCase()) || taken.has(skill.name.toLowerCase())) continue;
    const { score, matched } = scoreText(skill.name, skill.description, groups);
    if (!score) continue;
    scored.push({
      id: skill.id, name: skill.name, description: skill.description,
      reason: reasonText(matched), score: QODER_ONLY.test(skill.description) || QODER_ONLY.test(skill.name) ? score * 0.4 : score,
    });
  }
  for (const skill of web) {
    const keys = [skill.id.toLowerCase(), skill.name.toLowerCase()];
    if (keys.some((key) => taken.has(key) || installed.has(key))) continue;
    const { score, matched } = scoreText(skill.name, skill.description, groups);
    if (!score) continue;
    scored.push({
      id: skill.id, name: skill.name, description: skill.description, reason: reasonText(matched), score,
      source: 'web', url: skill.url, ...(skill.sha256 ? { sha256: skill.sha256 } : {}),
    });
  }
  return scored.sort((left, right) =>
    right.score - left.score || Number(left.source === 'web') - Number(right.source === 'web') || left.name.localeCompare(right.name))
    .slice(0, 5)
    .map(({ score: _score, ...skill }) => skill);
}

function suggestedMcp(servers: McpServer[], used: ActivityMcp[], groups: WordGroup[]): ActivityMcpSuggestion[] {
  const taken = new Set(used.map((server) => server.name.toLowerCase()));
  const scored: Array<ActivityMcpSuggestion & { score: number }> = [];
  for (const server of servers) {
    if (server.enabled === false || taken.has(server.name.toLowerCase())) continue;
    const { score, matched } = scoreText(server.name, '', groups);
    if (!score) continue;
    scored.push({ name: server.name, type: server.type, reason: reasonText(matched), score });
  }
  return scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map(({ score: _score, ...server }) => server);
}

function mergeSubagents(jobs: ActivitySubagentInput[], children: ActivityChildSessionInput[]): ActivitySubagent[] {
  const entries = new Map<string, ActivitySubagent>();
  for (const job of jobs) {
    entries.set(job.childSessionID, {
      id: job.id,
      sessionId: job.childSessionID,
      agent: job.agent,
      title: job.title || job.description || 'Subagent',
      description: job.description,
      status: job.status,
      startedAt: job.time.started,
      ...(job.time.completed === undefined ? {} : { completedAt: job.time.completed }),
      messages: subagentChat(job.messages),
    });
  }
  for (const child of children) {
    const existing = entries.get(child.id);
    if (existing) {
      if (!existing.messages.length && child.messages.length) existing.messages = subagentChat(child.messages);
      if ((!existing.title || existing.title === 'Subagent') && child.title) existing.title = child.title;
      continue;
    }
    entries.set(child.id, {
      id: child.id,
      sessionId: child.id,
      agent: child.agent || 'subagent',
      title: child.title || 'Subagent',
      description: '',
      status: child.status,
      startedAt: child.time.created,
      ...(child.status === 'completed' ? { completedAt: child.time.updated } : {}),
      messages: subagentChat(child.messages),
    });
  }
  return [...entries.values()].sort((left, right) => right.startedAt - left.startedAt);
}

export function buildActivity(input: ActivityInput): SessionActivity {
  const gather = [...input.messages, ...input.subagents.flatMap((subagent) => subagent.messages)];
  const groups = groupsOf(input.taskText);
  const subagents = mergeSubagents(input.subagents, input.childSessions ?? []);

  const skills = usedSkills(gather, input.skills);
  const mcp = usedMcp(gather, input.mcp);

  return {
    sessionId: input.sessionId,
    subagents,
    skills: { used: skills, suggested: suggestedSkills(input.skills, input.webSkills ?? [], skills, groups) },
    mcp: { used: mcp, suggested: suggestedMcp(input.mcp, mcp, groups) },
    artifacts: input.artifacts
      .map((artifact): ActivityArtifact => ({
        id: artifact.id, title: artifact.title, provider: artifact.provider,
        entry: artifact.entry, url: artifact.url, updatedAt: artifact.time.updated,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt),
    web: webSources(gather),
    sources: fileSources(gather),
  };
}
