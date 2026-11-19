import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHeadline, discoveryLayout, pluginFamily, type DiscoveryItem } from '../src/renderer/discovery.js';

const item = (id: string, name: string, family: string, installed = false, bundled = true): DiscoveryItem => ({
  id, name, description: `${name} description`, family, installed, bundled,
});

test('plugins are grouped into families by what they do', () => {
  assert.equal(pluginFamily('react-kit'), 'Frontend');
  assert.equal(pluginFamily('android-kit'), 'Mobile & desktop');
  assert.equal(pluginFamily('postgres-kit'), 'Backend & data');
  assert.equal(pluginFamily('kubernetes-kit'), 'DevOps');
  assert.equal(pluginFamily('testing-suite'), 'Testing & security');
  assert.equal(pluginFamily('docs-kit'), 'Product & writing');
  assert.equal(pluginFamily('git-suite'), 'Workflow');
  assert.equal(pluginFamily('ml-kit'), 'Data & AI');
  assert.equal(pluginFamily('unheard-of-tool'), 'Product & writing');
});

test('the headline names up to three families and counts the rest', () => {
  assert.equal(discoveryHeadline(['Frontend']), 'With Frontend');
  assert.equal(discoveryHeadline(['Frontend', 'DevOps']), 'With Frontend and DevOps');
  assert.equal(discoveryHeadline(['Frontend', 'DevOps', 'Testing & security']), 'With Frontend, DevOps and Testing & security');
  assert.equal(discoveryHeadline(['A', 'B', 'C', 'D', 'E']), 'With A, B, C and 2 more');
  assert.equal(discoveryHeadline([]), 'Nothing here yet');
});

test('chips list All, Installed, then families in catalog order', () => {
  const layout = discoveryLayout([
    item('a', 'Alpha', 'Frontend'),
    item('b', 'Beta', 'DevOps', true),
    item('c', 'Gamma', 'Frontend'),
  ], 'All', '');
  assert.deepEqual(layout.chips, ['All', 'Installed', 'Frontend', 'DevOps']);
  assert.deepEqual(layout.sections.map((section) => section.title), ['Frontend', 'DevOps']);
  assert.deepEqual(layout.sections[0].items.map((entry) => entry.id), ['a', 'c']);
});

test('the installed filter shows everything installed, including local-only items', () => {
  const layout = discoveryLayout([
    item('a', 'Alpha', 'Frontend'),
    item('b', 'Beta', 'DevOps', true),
    item('local', 'My own skill', 'Frontend', true, false),
  ], 'Installed', '');
  assert.deepEqual(layout.sections.map((section) => section.title), ['Installed']);
  assert.deepEqual(layout.sections[0].items.map((entry) => entry.id), ['b', 'local']);
});

test('local-only extensions stay out of catalog views', () => {
  const layout = discoveryLayout([
    item('a', 'Alpha', 'Frontend'),
    item('local', 'My own skill', 'Frontend', true, false),
  ], 'All', '');
  assert.deepEqual(layout.sections[0].items.map((entry) => entry.id), ['a']);
});

test('family chips narrow the sections and search matches names', () => {
  const items = [
    item('a', 'Alpha', 'Frontend'),
    item('b', 'Beta', 'DevOps'),
    item('c', 'Gamma', 'DevOps'),
  ];
  const frontend = discoveryLayout(items, 'Frontend', '');
  assert.deepEqual(frontend.sections.map((section) => section.title), ['Frontend']);
  const search = discoveryLayout(items, 'All', 'gamm');
  assert.deepEqual(search.sections.map((section) => section.title), ['DevOps']);
  assert.deepEqual(search.sections[0].items.map((entry) => entry.id), ['c']);
  assert.deepEqual(discoveryLayout(items, 'All', 'zzz').sections, []);
});

test('search ignores case and surrounding spaces', () => {
  const layout = discoveryLayout([item('a', 'Alpha', 'Frontend')], 'All', '  ALPH ');
  assert.deepEqual(layout.sections[0].items.map((entry) => entry.id), ['a']);
});

test('extra chips filter by tags after the family chips', () => {
  const items = [
    { ...item('a', 'Alpha', 'Frontend'), tags: ['Local'] },
    { ...item('b', 'Beta', 'Frontend'), tags: ['Remote'] },
  ];
  const layout = discoveryLayout(items, 'Local', '', ['Local', 'Remote']);
  assert.deepEqual(layout.chips, ['All', 'Installed', 'Frontend', 'Local', 'Remote']);
  assert.deepEqual(layout.sections[0].items.map((entry) => entry.id), ['a']);
});