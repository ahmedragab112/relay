import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/main/engine.js';
import type { AppEvent } from '../src/shared/contracts.js';

interface PermissionReply { sessionID: string; requestID: string; decision: string }
interface FormCancel { sessionID: string; formID: string }

function harness(root: string) {
  const events: AppEvent[] = [];
  const replies: PermissionReply[] = [];
  const cancels: FormCancel[] = [];
  const permissions: unknown[] = [];
  const forms: unknown[] = [];
  const engine = new Engine(root, '/bin/false', (event) => events.push(event));
  const client = {
    session: {
      active: async () => ({}),
      list: async () => ({ data: [] }),
      form: { cancel: async (input: FormCancel) => { cancels.push(input); } },
    },
    permission: {
      reply: async (input: PermissionReply) => { replies.push(input); },
      request: { list: async () => ({ data: permissions }) },
    },
    form: { list: async () => ({ data: forms }) },
  };
  const internals = engine as unknown as {
    client: unknown;
    directory: string;
    event: (event: { type: string; data?: unknown }) => void;
    silenceSession: (id: string) => void;
  };
  internals.client = client;
  internals.directory = '/tmp/relay-silent-project';
  const ask = (sessionID: string, id = `perm-${sessionID}`) =>
    internals.event({ type: 'permission.asked', data: { id, sessionID, action: 'shell', resources: ['git status'] } });
  const form = (sessionID: string, id = `form-${sessionID}`) =>
    internals.event({ type: 'form.created', data: { form: { id, sessionID, title: 'Pick one', fields: [] } } });
  return { engine, internals, events, replies, cancels, permissions, forms, ask, form };
}

test('a silent session approves its own permissions and never surfaces them', () => {
  return (async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-silent-'));
    try {
      const h = harness(root);
      h.internals.silenceSession('ses_atlas');
      h.ask('ses_atlas');
      assert.equal(h.events.filter((event) => event.type === 'permission').length, 0, 'a silent permission was emitted');
      assert.deepEqual(h.replies, [{ sessionID: 'ses_atlas', requestID: 'perm-ses_atlas', decision: 'once' }]);
      h.internals.event({ type: 'permission.replied', data: { requestID: 'perm-ses_atlas', sessionID: 'ses_atlas' } });
      assert.equal(h.events.filter((event) => event.type === 'permission-resolved').length, 0, 'a resolved silent permission was emitted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  })();
});

test('a silent session cancels its own questions instead of showing them', () => {
  return (async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-silent-'));
    try {
      const h = harness(root);
      h.internals.silenceSession('ses_atlas');
      h.form('ses_atlas');
      assert.equal(h.events.filter((event) => event.type === 'question').length, 0, 'a silent question was emitted');
      assert.deepEqual(h.cancels, [{ sessionID: 'ses_atlas', formID: 'form-ses_atlas' }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  })();
});

test('ordinary sessions still surface permissions and questions', () => {
  return (async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-silent-'));
    try {
      const h = harness(root);
      h.ask('ses_task');
      h.form('ses_task');
      const permission = h.events.find((event) => event.type === 'permission');
      const question = h.events.find((event) => event.type === 'question');
      assert.equal((permission as { request?: { sessionId?: string } } | undefined)?.request?.sessionId, 'ses_task');
      assert.equal((question as { request?: { sessionId?: string } } | undefined)?.request?.sessionId, 'ses_task');
      assert.deepEqual(h.replies, []);
      assert.deepEqual(h.cancels, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  })();
});

test('attention and approval listings skip silent sessions even before their events run', () => {
  return (async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-silent-'));
    try {
      const h = harness(root);
      h.internals.silenceSession('ses_atlas');
      h.permissions.push(
        { id: 'perm-atlas', sessionID: 'ses_atlas', action: 'shell', resources: ['git status'] },
        { id: 'perm-task', sessionID: 'ses_task', action: 'shell', resources: ['git status'] },
      );
      h.forms.push({ id: 'form-atlas', sessionID: 'ses_atlas', title: 'Pick one', fields: [] });
      const overview = await h.engine.listAttention();
      assert.deepEqual(overview.permissions.map((item) => item.request.id), ['perm-task']);
      assert.deepEqual(overview.questions, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  })();
});
