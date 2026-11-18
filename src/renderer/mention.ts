// Pure helpers for the composer's @-mention menu. The composer owns all DOM;
// these functions only parse the typed token and filter the menu sources so the
// behavior stays unit-testable.

export type MentionKind = 'file' | 'skill' | 'plugin' | 'agent' | 'connector' | 'atlas';

export interface MentionSource {
  kind: MentionKind;
  /** Stable identity used for filtering and tests. */
  id: string;
  /** Display name matched against the typed query. */
  name: string;
  /** Short subtitle shown under the name. */
  detail?: string;
  /** Files attach by workspace path. */
  path?: string;
  /** Skills attach by skill id. */
  skillId?: string;
  /** Agents attach by agent name. */
  agentName?: string;
  /** Plugins attach by enabling their skills on the message. */
  pluginSkills?: { id: string; name: string }[];
  /** Connectors attach as a context block describing the server. */
  connector?: { name: string; type: 'local' | 'remote'; command?: string[]; url?: string; description?: string };
}

export interface MentionToken {
  query: string;
  start: number;
  end: number;
}

/** Matches `@word` when it ends exactly at the caret, like Slack/Cursor mentions. */
export function parseMentionToken(text: string, caret: number): MentionToken | undefined {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /@([A-Za-z0-9_-]*)$/.exec(upto);
  if (!match) return undefined;
  return { query: match[1] ?? '', start: caret - match[0].length, end: caret };
}

/** Case-insensitive name filter; an empty query keeps everything in source order. */
export function filterMentionables(sources: MentionSource[], query: string): MentionSource[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sources];
  return sources.filter(source => source.name.toLowerCase().includes(needle));
}

/**
 * The @atlas row: it opens the Atlas page/card picker instead of attaching
 * something directly. It appears only once the typed query points at it, so a
 * bare `@` stays focused on files, skills, and tools.
 */
export function atlasMention(query: string): MentionSource | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle || !'atlas'.startsWith(needle)) return undefined;
  return { kind: 'atlas', id: 'atlas', name: 'Atlas', detail: 'Project knowledge — pages and module cards' };
}
