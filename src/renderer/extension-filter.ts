import type { McpServer, PluginCatalogEntry } from '../shared/contracts';

export type ExtensionTab = 'skills' | 'plugins' | 'connectors';
export type PluginFilter = 'all' | 'featured' | 'installed';
export type ConnectorFilter = 'all' | 'local' | 'remote' | 'enabled';

export function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => (value ?? '').toLowerCase().includes(needle));
}

export function filterPlugins(entries: PluginCatalogEntry[], query: string, filter: PluginFilter): PluginCatalogEntry[] {
  return entries.filter((entry) =>
    matchesQuery(query, entry.name, entry.description) && (filter !== 'installed' || entry.installed));
}

export function filterConnectors(servers: McpServer[], query: string, filter: ConnectorFilter): McpServer[] {
  return servers.filter((server) =>
    matchesQuery(query, server.name, server.type === 'local' ? (server.command ?? []).join(' ') : server.url)
    && (filter === 'all' || (filter === 'enabled' ? server.enabled : server.type === filter)));
}
