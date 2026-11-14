import test from 'node:test';
import assert from 'node:assert/strict';
import { renderA11ySnapshot, type A11yNode } from '../src/main/browser-snapshot.js';

/** Minimal CDP-shaped accessibility node. */
function ax(over: Partial<A11yNode> & { nodeId: string }): A11yNode {
  return {
    role: { type: 'role', value: 'generic' },
    ignored: false,
    childIds: [],
    ...over,
  };
}

const prop = (name: string, value: unknown) => ({ name, value: { type: 'boolean', value } });

test('renders an aria-style tree with refs only on actionable elements', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, name: { type: 'string', value: 'Example' }, childIds: ['2', '4', '5'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'heading' }, name: { type: 'string', value: 'Welcome' }, properties: [prop('level', 1)], childIds: ['3'] }),
    ax({ nodeId: '3', role: { type: 'role', value: 'StaticText' }, name: { type: 'string', value: 'Hello world' } }),
    ax({ nodeId: '4', role: { type: 'role', value: 'button' }, name: { type: 'string', value: 'Submit' } }),
    ax({ nodeId: '5', role: { type: 'role', value: 'generic' } }),
  ];
  const out = renderA11ySnapshot(nodes);
  const lines = out.content.split('\n');
  assert.deepEqual(lines, [
    '- RootWebArea "Example"',
    '  - heading "Welcome" [level=1]',
    '    - text "Hello world"',
    '  - button "Submit"',
    '  - generic',
  ]);
  assert.equal(out.refs.size, 0, 'no ref without a backend node id');
});

test('refs map to backend node ids and increment in document order', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2', '3', '4'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'link' }, name: { type: 'string', value: 'Docs' }, backendDOMNodeId: 21 }),
    ax({ nodeId: '3', role: { type: 'role', value: 'textbox' }, name: { type: 'string', value: 'Email' }, backendDOMNodeId: 33, properties: [prop('focusable', true)] }),
    ax({ nodeId: '4', role: { type: 'role', value: 'checkbox' }, name: { type: 'string', value: 'Remember' }, backendDOMNodeId: 44, properties: [prop('checked', true)] }),
  ];
  const out = renderA11ySnapshot(nodes);
  const lines = out.content.split('\n');
  assert.match(lines[1], /- link "Docs" \[ref=e1\]/);
  assert.match(lines[2], /- textbox "Email" \[ref=e2\]/);
  assert.match(lines[3], /- checkbox "Remember" \[checked\] \[ref=e3\]/);
  assert.deepEqual([...out.refs.entries()], [['e1', 21], ['e2', 33], ['e3', 44]]);
});

test('ignored nodes are skipped but their children still render', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'presentation' }, ignored: true, childIds: ['3'] }),
    ax({ nodeId: '3', role: { type: 'role', value: 'link' }, name: { type: 'string', value: 'Skip' }, backendDOMNodeId: 9 }),
  ];
  const out = renderA11ySnapshot(nodes);
  const lines = out.content.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /- link "Skip" \[ref=e1\]/);
});

test('textboxes do not descend into their children', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'textbox' }, name: { type: 'string', value: 'Body' }, childIds: ['3'] }),
    ax({ nodeId: '3', role: { type: 'role', value: 'StaticText' }, name: { type: 'string', value: 'typed' } }),
  ];
  const out = renderA11ySnapshot(nodes);
  assert.equal(out.content.split('\n').length, 2);
  assert.doesNotMatch(out.content, /typed/);
});

test('state flags: disabled, expanded, selected, checked mixed', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2', '3', '4', '5'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'button' }, name: { type: 'string', value: 'Off' }, backendDOMNodeId: 2, properties: [prop('disabled', true)] }),
    ax({ nodeId: '3', role: { type: 'role', value: 'button' }, name: { type: 'string', value: 'Menu' }, backendDOMNodeId: 3, properties: [prop('expanded', true)] }),
    ax({ nodeId: '4', role: { type: 'role', value: 'option' }, name: { type: 'string', value: 'One' }, backendDOMNodeId: 4, properties: [prop('selected', true)] }),
    ax({ nodeId: '5', role: { type: 'role', value: 'checkbox' }, name: { type: 'string', value: 'Mix' }, backendDOMNodeId: 5, properties: [prop('checked', 'mixed')] }),
  ];
  const out = renderA11ySnapshot(nodes);
  assert.match(out.content, /- button "Off" \[disabled\] \[ref=e1\]/);
  assert.match(out.content, /- button "Menu" \[expanded\] \[ref=e2\]/);
  assert.match(out.content, /- option "One" \[selected\] \[ref=e3\]/);
  assert.match(out.content, /- checkbox "Mix" \[checked=mixed\] \[ref=e4\]/);
});

test('depth limits traversal and reports truncation', () => {
  const nodes: A11yNode[] = [ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2'] })];
  for (let level = 2; level <= 20; level++) {
    nodes.push(ax({ nodeId: String(level), role: { type: 'role', value: 'group' }, childIds: level < 20 ? [String(level + 1)] : [] }));
  }
  const out = renderA11ySnapshot(nodes, { depth: 3 });
  assert.equal(out.truncated, true);
  assert.ok(out.content.split('\n').length <= 5);
});

test('find filters lines case-insensitively', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2', '3'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'link' }, name: { type: 'string', value: 'Pricing Plans' }, backendDOMNodeId: 7 }),
    ax({ nodeId: '3', role: { type: 'role', value: 'link' }, name: { type: 'string', value: 'Contact' }, backendDOMNodeId: 8 }),
  ];
  const out = renderA11ySnapshot(nodes, { find: 'pricing' });
  assert.doesNotMatch(out.content, /Contact/);
  assert.match(out.content, /Pricing Plans/);
});

test('very long output is truncated at the line cap and content cap', () => {
  const nodes: A11yNode[] = [ax({ nodeId: '0', role: { type: 'role', value: 'RootWebArea' }, childIds: [] })];
  for (let index = 1; index <= 700; index++) {
    nodes.push(ax({ nodeId: String(index), role: { type: 'role', value: 'button' }, name: { type: 'string', value: 'n'.repeat(200) } }));
    nodes[0].childIds!.push(String(index));
  }
  const out = renderA11ySnapshot(nodes);
  assert.equal(out.truncated, true);
  assert.ok(out.content.split('\n').length <= 501);
  assert.ok(out.content.length <= 100_000);
});

test('long names collapse whitespace and clamp to 300 characters', () => {
  const nodes = [ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, name: { type: 'string', value: `a  b${' c'.repeat(200)}` } })];
  const out = renderA11ySnapshot(nodes);
  const name = out.content.match(/"([^"]*)"/)![1];
  assert.equal(name.slice(0, 3), 'a b');
  assert.equal(name.length, 300);
  assert.equal(out.truncated, false, 'clamped names do not count as truncation');
});

test('heading level comes from properties; unknown roles render bare', () => {
  const nodes = [
    ax({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2'] }),
    ax({ nodeId: '2', role: { type: 'role', value: 'List' }, childIds: ['3'] }),
    ax({ nodeId: '3', role: { type: 'role', value: 'heading' }, properties: [prop('level', 3)] }),
  ];
  const out = renderA11ySnapshot(nodes);
  assert.match(out.content, /- List/);
  assert.match(out.content, /- heading \[level=3\]/);
});
