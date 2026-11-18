import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/main/engine.js';

function transportError(): Error {
  return Object.assign(new Error('Transport: fetch failed'), { name: 'ClientError', reason: 'Transport' });
}

function harness(waits: Array<() => Promise<void>>, info: () => Promise<unknown>) {
  let calls = 0;
  const signals: Array<AbortSignal | undefined> = [];
  const engine = new Engine('/tmp/relay-idle-wait', '/bin/false', () => {});
  const client = {
    server: { info },
    experimental: {
      session: {
        wait: async (_input: { sessionID: string }, options?: { signal?: AbortSignal }) => {
          const attempt = waits[calls];
          calls += 1;
          signals.push(options?.signal);
          await (attempt ?? (async () => undefined))();
        },
      },
    },
  };
  Object.assign(engine as unknown as { client: unknown; stopped: boolean }, { client, stopped: false });
  return { engine, signals, calls: () => calls };
}

test('a wait dropped by the transport resumes instead of failing the build', () => {
  return (async () => {
    const h = harness([async () => { throw transportError(); }, async () => undefined], async () => ({}));
    await h.engine.waitForIdle('ses_atlas');
    assert.equal(h.calls(), 2);
  })();
});

test('a dead engine surfaces the transport error instead of retrying forever', () => {
  return (async () => {
    const h = harness(
      [async () => { throw transportError(); }],
      async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1'); },
    );
    await assert.rejects(() => h.engine.waitForIdle('ses_atlas'), /Transport: fetch failed/);
    assert.equal(h.calls(), 1);
  })();
});

test('an engine error that is not a transport drop surfaces without a retry', () => {
  return (async () => {
    const h = harness(
      [async () => { throw Object.assign(new Error('UnexpectedStatus: 404'), { name: 'ClientError', reason: 'UnexpectedStatus' }); }],
      async () => ({}),
    );
    await assert.rejects(() => h.engine.waitForIdle('ses_atlas'), /404/);
    assert.equal(h.calls(), 1);
  })();
});

test('each wait carries an abort signal so a silent connection is sliced below the transport cutoff', () => {
  return (async () => {
    const h = harness([async () => undefined], async () => ({}));
    await h.engine.waitForIdle('ses_atlas');
    assert.ok(h.signals[0], 'wait was sent without an abort signal');
  })();
});
