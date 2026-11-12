import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, type ActivityInput, type ActivityMessageInput } from '../src/main/activity.js';

const created = (value: number) => ({ created: value });

function userMessage(id: string, text: string, extra: Partial<ActivityMessageInput> = {}): ActivityMessageInput {
  return { type: 'user', id, time: created(10), text, ...extra };
}

function tool(name: string, input: unknown, status = 'completed'): NonNullable<ActivityMessageInput['content']>[number] {
  return { type: 'tool', id: `tool-${name}-${status}`, name, state: { status, input } };
}

function assistant(id: string, at: number, content: NonNullable<ActivityMessageInput['content']>): ActivityMessageInput {
  return { type: 'assistant', id, time: created(at), content };
}

function base(overrides: Partial<ActivityInput> = {}): ActivityInput {
  return { sessionId: 's1', messages: [], subagents: [], artifacts: [], skills: [], mcp: [], taskText: '', ...overrides };
}

test('collects skills requested in messages and activated by the agent', () => {
  const activity = buildActivity(base({
    messages: [
      userMessage('m1', 'Plan this feature', { skills: [{ id: 'superpowers:brainstorming', name: 'brainstorming' }] }),
      { type: 'skill', id: 'm2', time: created(20), skill: 'pdfs', name: 'pdfs', text: 'Read the specification' },
    ],
    skills: [
      { id: 'superpowers:brainstorming', name: 'Brainstorming', description: 'Plan features with the user' },
      { id: 'pdfs', name: 'PDFs', description: 'Read PDF files' },
    ],
  }));
  assert.equal(activity.skills.used.length, 2);
  assert.equal(activity.skills.used[0].id, 'pdfs');
  assert.equal(activity.skills.used[0].name, 'PDFs');
  assert.equal(activity.skills.used[0].description, 'Read PDF files');
  assert.equal(activity.skills.used[0].uses, 1);
  assert.equal(activity.skills.used[1].id, 'superpowers:brainstorming');
});

test('groups MCP tool calls by server and leaves built-in tools out', () => {
  const activity = buildActivity(base({
    messages: [assistant('a1', 30, [
      tool('mcp__chrome-devtools__take_screenshot', {}),
      tool('mcp__chrome-devtools__click', { uid: '1' }),
      tool('bash', { command: 'ls' }),
      tool('mcp__broken', {}),
    ])],
    mcp: [{ name: 'chrome-devtools', type: 'local', command: ['npx', 'chrome-devtools-mcp'], enabled: true }],
  }));
  assert.equal(activity.mcp.used.length, 1);
  assert.equal(activity.mcp.used[0].name, 'chrome-devtools');
  assert.equal(activity.mcp.used[0].type, 'local');
  assert.equal(activity.mcp.used[0].uses, 2);
  assert.equal(activity.skills.used.length, 0);
});

test('records web pages and searches, merging repeats', () => {
  const activity = buildActivity(base({
    messages: [
      assistant('a1', 30, [tool('webfetch', { url: 'https://example.com/release' })]),
      assistant('a2', 40, [tool('webfetch', { url: 'https://example.com/release' }), tool('websearch', { query: 'electron ipc streaming' })]),
    ],
  }));
  assert.equal(activity.web.length, 2);
  const page = activity.web.find((source) => source.url === 'https://example.com/release');
  assert.equal(page?.kind, 'fetch');
  assert.equal(page?.mentions, 2);
  assert.equal(page?.lastUsed, 40);
  const search = activity.web.find((source) => source.kind === 'search');
  assert.equal(search?.label, 'electron ipc streaming');
});

test('lists attachments and read files with their kind', () => {
  const activity = buildActivity(base({
    messages: [
      userMessage('m1', 'Use these files', { files: [
        { name: 'spec.pdf', source: { type: 'inline' } },
        { name: 'screen.png', source: { type: 'inline' } },
        { name: 'notes.md', source: { type: 'inline' } },
      ] }),
      assistant('a1', 50, [tool('read', { path: 'docs/guide.pdf' }), tool('read', { filePath: 'docs/guide.pdf' })]),
    ],
  }));
  const byName = new Map(activity.sources.map((source) => [source.name, source]));
  assert.equal(byName.get('spec.pdf')?.kind, 'pdf');
  assert.equal(byName.get('screen.png')?.kind, 'image');
  assert.equal(byName.get('notes.md')?.kind, 'document');
  assert.equal(byName.get('guide.pdf')?.mentions, 2);
});

test('lists subagents with their chats and outcomes', () => {
  const activity = buildActivity(base({
    subagents: [{
      id: 'job-1', childSessionID: 'child-1', agent: 'explore', description: 'Inspect the layout',
      status: 'completed', time: { started: 100, completed: 200 },
      messages: [
        userMessage('c1', 'Inspect the header'),
        assistant('c2', 150, [{ type: 'text', text: 'The header uses flex layout.' }, tool('read', { path: 'src/header.ts' })]),
      ],
    }],
  }));
  const subagent = activity.subagents[0];
  assert.equal(subagent.id, 'job-1');
  assert.equal(subagent.sessionId, 'child-1');
  assert.equal(subagent.agent, 'explore');
  assert.equal(subagent.title, 'Inspect the layout');
  assert.equal(subagent.status, 'completed');
  assert.equal(subagent.startedAt, 100);
  assert.equal(subagent.completedAt, 200);
  assert.deepEqual(subagent.messages.map((message) => message.role), ['user', 'assistant']);
  assert.match(subagent.messages[1].text, /header uses flex/);
  assert.match(subagent.messages[1].text, /read/);
});

test('merges child sessions the job feed forgot into the subagent list', () => {
  const activity = buildActivity(base({
    subagents: [{
      id: 'job-1', childSessionID: 'child-1', agent: 'explore', description: 'Inspect the layout',
      status: 'running', time: { started: 100 }, messages: [],
    }],
    childSessions: [
      { id: 'child-1', agent: 'explore', title: 'Inspect the layout', status: 'running', time: { created: 90, updated: 180 }, messages: [userMessage('c1', 'Inspect the header')] },
      { id: 'child-2', agent: 'build', title: 'Fix the header', status: 'completed', time: { created: 120, updated: 300 }, messages: [userMessage('d1', 'Fix it'), assistant('d2', 250, [{ type: 'text', text: 'Fixed.' }])] },
    ],
  }));
  assert.deepEqual(activity.subagents.map((item) => item.sessionId), ['child-2', 'child-1']);
  const finished = activity.subagents[0];
  assert.equal(finished.agent, 'build');
  assert.equal(finished.title, 'Fix the header');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.startedAt, 120);
  assert.equal(finished.completedAt, 300);
  assert.deepEqual(finished.messages.map((message) => message.text), ['Fix it', 'Fixed.']);
  const running = activity.subagents[1];
  assert.equal(running.id, 'job-1');
  assert.equal(running.startedAt, 100);
  assert.deepEqual(running.messages.map((message) => message.text), ['Inspect the header']);
});

test('lists artifacts for the task', () => {
  const activity = buildActivity(base({
    artifacts: [{ id: 'art-1', provider: 'static', title: 'Release report', entry: 'index.html', url: '/artifacts/art-1', time: { created: 1, updated: 5 } }],
  }));
  assert.deepEqual(activity.artifacts, [{ id: 'art-1', title: 'Release report', provider: 'static', entry: 'index.html', url: '/artifacts/art-1', updatedAt: 5 }]);
});

test('suggests unused skills from the task words and downranks Qoder-only tools', () => {
  const activity = buildActivity(base({
    taskText: 'Test the HTTP endpoints and deploy',
    messages: [userMessage('m1', 'Test the HTTP endpoints', { skills: [{ id: 'api', name: 'API testing' }] })],
    skills: [
      { id: 'api', name: 'API testing', description: 'Test HTTP endpoints' },
      { id: 'screens', name: 'Screenshot review', description: 'Review UI screenshots' },
      { id: 'deploy', name: 'Deploy with Qoder', description: 'Deploy releases with Qoder desktop tools only' },
      { id: 'unrelated', name: 'Spreadsheet maths', description: 'Totals and pivots' },
    ],
  }));
  const ids = activity.skills.suggested.map((skill) => skill.id);
  assert.ok(ids.includes('screens'), 'a matching skill was missing');
  assert.ok(ids.includes('deploy'), 'a lower ranked match was missing');
  assert.ok(!ids.includes('api'), 'a used skill was suggested again');
  assert.ok(!ids.includes('unrelated'), 'an unrelated skill was suggested');
  const screens = activity.skills.suggested.find((skill) => skill.id === 'screens');
  assert.match(screens?.reason ?? '', /test|http|endpoints/i);
  assert.equal(activity.skills.suggested[0].id, 'screens');
});

test('keeps the skill suggestions short and ordered by relevance', () => {
  const skills = Array.from({ length: 7 }, (_, index) => ({ id: `design-${index}`, name: `Design helper ${index}`, description: 'Design review guidance' }));
  skills.push({ id: 'best', name: 'Design review', description: 'Design UI review checklists' });
  const activity = buildActivity(base({ taskText: 'Run a design review', skills }));
  assert.equal(activity.skills.suggested.length, 5);
  assert.equal(activity.skills.suggested[0].id, 'best');
});

test('suggests web registry skills that match the task without repeating installed ones', () => {
  const activity = buildActivity(base({
    taskText: 'Review screenshots of the dashboard',
    skills: [{ id: 'screens', name: 'Screenshot review', description: 'Review UI screenshots' }],
    webSkills: [
      { id: 'visual-review', name: 'Visual review', description: 'Review UI screenshots and layout', url: 'https://example.com/visual.zip' },
      { id: 'screens', name: 'Screenshot review', description: 'Review UI screenshots', url: 'https://example.com/screens.zip' },
      { id: 'spreadsheet', name: 'Spreadsheet maths', description: 'Totals and pivots', url: 'https://example.com/sheets.zip' },
    ],
  }));
  const web = activity.skills.suggested.filter((skill) => skill.source === 'web');
  assert.equal(web.length, 1);
  assert.equal(web[0].id, 'visual-review');
  assert.equal(web[0].url, 'https://example.com/visual.zip');
  assert.match(web[0].reason, /review|screenshot/i);
  assert.ok(!activity.skills.suggested.some((skill) => skill.id === 'spreadsheet'));
  assert.ok(!web.some((skill) => skill.id === 'screens'), 'an installed skill was suggested from the web');
});

test('a stronger installed match is ranked above a weaker web match', () => {
  const activity = buildActivity(base({
    taskText: 'Audit the database schema',
    skills: [{ id: 'db-audit', name: 'Database audit', description: 'Review schema changes' }],
    webSkills: [{ id: 'audit-web', name: 'Audit helper', description: 'Generic audit checklists', url: 'https://example.com/audit.zip' }],
  }));
  assert.equal(activity.skills.suggested[0].id, 'db-audit');
  assert.equal(activity.skills.suggested[0].source, undefined);
  assert.equal(activity.skills.suggested[1].source, 'web');
});

test('suggests enabled MCP servers that match the task and skips used or disabled ones', () => {
  const activity = buildActivity(base({
    taskText: 'Push the branch to GitHub with the browser open',
    messages: [assistant('a1', 30, [tool('mcp__chrome-devtools__navigate_page', { url: 'https://github.com' })])],
    mcp: [
      { name: 'chrome-devtools', type: 'local', command: ['npx', 'chrome-devtools-mcp'], enabled: true },
      { name: 'github', type: 'remote', url: 'https://example.com/mcp', enabled: true },
      { name: 'github-archive', type: 'remote', url: 'https://example.com/old', enabled: false },
    ],
  }));
  assert.equal(activity.mcp.used.length, 1);
  assert.equal(activity.mcp.used[0].name, 'chrome-devtools');
  assert.equal(activity.mcp.suggested.length, 1);
  assert.equal(activity.mcp.suggested[0].name, 'github');
  assert.match(activity.mcp.suggested[0].reason, /github/i);
});

test('an empty task returns empty sections', () => {
  const activity = buildActivity(base());
  assert.deepEqual(activity, {
    sessionId: 's1', subagents: [], skills: { used: [], suggested: [] }, mcp: { used: [], suggested: [] }, artifacts: [], web: [], sources: [],
  });
});
