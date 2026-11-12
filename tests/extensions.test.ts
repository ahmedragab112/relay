import test from 'node:test';
import assert from 'node:assert/strict';
import { filterConnectors, filterPlugins, matchesQuery } from '../src/renderer/extension-filter.js';
import type { McpServer, PluginCatalogEntry } from '../src/shared/contracts.js';

const capabilities = { skills: [], commands: [], agents: [], mcp: [], code: [] };
const plugin = (id: string, description: string, installed = false): PluginCatalogEntry => ({
  id, name: id, version: '1.0.0', description, capabilities, digest: '', installed,
});
const server = (name: string, type: 'local' | 'remote', enabled = true): McpServer => ({ name, type, enabled });

test('search matches names and descriptions case-insensitively', () => {
  const entries = [plugin('Code review', 'Reviews local changes'), plugin('Commit notes', 'Writes release notes')];
  assert.deepEqual(filterPlugins(entries, 'code', 'all').map((entry) => entry.id), ['Code review']);
  assert.deepEqual(filterPlugins(entries, 'NOTES', 'all').map((entry) => entry.id), ['Commit notes']);
  assert.equal(matchesQuery('  release ', 'irrelevant', 'Writes release notes'), true);
  assert.equal(matchesQuery('', 'anything'), true);
  assert.deepEqual(filterPlugins(entries, 'absent', 'all'), []);
});

test('plugin chips narrow by featured and installed state', () => {
  const entries = [plugin('A', 'first', true), plugin('B', 'second', false)];
  assert.deepEqual(filterPlugins(entries, '', 'installed').map((entry) => entry.id), ['A']);
  assert.deepEqual(filterPlugins(entries, '', 'featured').map((entry) => entry.id), ['A', 'B']);
});

test('connectors filter by transport, enabled state and query', () => {
  const servers = [server('local-tools', 'local'), server('remote-tools', 'remote', false)];
  assert.deepEqual(filterConnectors(servers, '', 'local').map((item) => item.name), ['local-tools']);
  assert.deepEqual(filterConnectors(servers, '', 'remote').map((item) => item.name), ['remote-tools']);
  assert.deepEqual(filterConnectors(servers, '', 'enabled').map((item) => item.name), ['local-tools']);
  assert.deepEqual(filterConnectors(servers, 'remote', 'all').map((item) => item.name), ['remote-tools']);
});
