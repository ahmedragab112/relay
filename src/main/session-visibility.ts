// Atlas runs use a real engine session, but they are not chats: they must never
// appear as tasks. The reserved title marks them, and their ids are hidden from
// every listing (sidebar, Attention, search, CLI).

export const ATLAS_TITLE_PREFIX = 'Atlas · ';

export const atlasSessionTitle = (projectName: string): string => `${ATLAS_TITLE_PREFIX}${projectName}`;

export const isAtlasSession = (item: { title: string }): boolean => item.title.startsWith(ATLAS_TITLE_PREFIX);

/** Drops sessions the app hides on purpose; returns the same array when nothing is hidden. */
export function visibleSessions<T extends { id: string }>(items: T[], hidden: ReadonlySet<string>): T[] {
  return hidden.size ? items.filter((item) => !hidden.has(item.id)) : items;
}
