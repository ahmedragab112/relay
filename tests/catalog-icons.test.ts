import test from 'node:test';
import assert from 'node:assert/strict';
import { skillIcon, pluginIcon, connectorIcon } from '../src/renderer/catalog-icons.js';

test('every bundled skill category maps to its own themed icon', () => {
  const categories = [
    'Engineering', 'Frontend', 'Mobile & desktop', 'Languages', 'Data & AI',
    'Backend & data', 'DevOps', 'Testing & security', 'Product & writing', 'Workflow',
  ];
  const specs = categories.map(skillIcon);
  for (const spec of specs) {
    assert.ok(spec.kind, 'every category needs an icon kind');
    assert.match(spec.color, /^#[0-9a-f]{6}$/i, 'icon colors are hex');
  }
  assert.equal(new Set(specs.map((spec) => spec.kind)).size, categories.length, 'categories should not share icons');
});

test('unknown skill categories fall back to one stable icon', () => {
  assert.equal(skillIcon('Something new').kind, skillIcon('Other').kind);
});

test('popular plugin kits map to themed icons', () => {
  assert.equal(pluginIcon('React kit').kind, 'react');
  assert.equal(pluginIcon('Docker kit').kind, 'cloud');
  assert.equal(pluginIcon('Git suite').kind, 'git');
  assert.equal(pluginIcon('Auth kit').kind, 'shield');
  assert.equal(pluginIcon('ML kit').kind, 'spark');
  assert.equal(pluginIcon('SQL kit').kind, 'database');
  assert.equal(pluginIcon('CI kit').kind, 'rocket');
  assert.equal(pluginIcon('Docs suite').kind, 'pen');
  assert.equal(pluginIcon('CSS kit').kind, 'layout');
  assert.equal(pluginIcon('iOS kit').kind, 'device');
  assert.equal(pluginIcon('API kit').kind, 'code');
});

test('every plugin kit name resolves to an icon', () => {
  const names = [
    'a11y kit', 'ADR kit', 'Analytics kit', 'Android kit', 'Animation kit', 'API kit',
    'WebSocket kit', 'Warehouse kit', 'Vue kit', 'Triage kit', 'Translation kit',
  ];
  for (const name of names) {
    const spec = pluginIcon(name);
    assert.ok(spec.kind, `${name} resolved to no icon`);
    assert.match(spec.color, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(pluginIcon('Zebra crossings').kind, 'kit', 'unknown names use the kit puzzle icon');
});

test('connectors map by name keywords and keep a plug fallback', () => {
  assert.equal(connectorIcon('GitHub', 'remote').kind, 'git');
  assert.equal(connectorIcon('GitLab', 'local').kind, 'git');
  assert.equal(connectorIcon('Slack', 'remote').kind, 'chat');
  assert.equal(connectorIcon('Postgres', 'local').kind, 'database');
  assert.equal(connectorIcon('Cloudflare', 'remote').kind, 'cloud');
  assert.equal(connectorIcon('Wikipedia', 'remote').kind, 'globe');
  assert.equal(connectorIcon('Figma', 'remote').kind, 'layout');
  assert.equal(connectorIcon('MysteryThing', 'local').kind, 'plug');
  assert.equal(connectorIcon('MysteryThing', 'remote').kind, 'plug');
});
