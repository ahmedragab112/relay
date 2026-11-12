import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStreamEvent } from '../src/main/streaming.js';

const base = { sessionID: 'ses_1', assistantMessageID: 'msg_1', ordinal: 2 };

test('maps text deltas to an incremental stream event', () => {
  assert.deepEqual(mapStreamEvent({ type: 'session.text.delta', data: { ...base, delta: 'Hello' } }), {
    type: 'session-stream',
    sessionId: 'ses_1',
    messageId: 'msg_1',
    kind: 'text',
    ordinal: 2,
    text: 'Hello',
    ended: false,
  });
});

test('maps text endings to a stream event carrying the full text', () => {
  assert.deepEqual(mapStreamEvent({ type: 'session.text.ended', data: { ...base, text: 'Hello world' } }), {
    type: 'session-stream',
    sessionId: 'ses_1',
    messageId: 'msg_1',
    kind: 'text',
    ordinal: 2,
    text: 'Hello world',
    ended: true,
  });
});

test('maps reasoning deltas separately from answer text', () => {
  assert.deepEqual(mapStreamEvent({ type: 'session.reasoning.delta', data: { ...base, delta: 'Thinking' } }), {
    type: 'session-stream',
    sessionId: 'ses_1',
    messageId: 'msg_1',
    kind: 'reasoning',
    ordinal: 2,
    text: 'Thinking',
    ended: false,
  });
});

test('maps reasoning endings to the final reasoning text', () => {
  assert.equal(mapStreamEvent({ type: 'session.reasoning.ended', data: { ...base, text: 'Considered' } })?.text, 'Considered');
  assert.equal(mapStreamEvent({ type: 'session.reasoning.ended', data: { ...base, text: 'Considered' } })?.ended, true);
});

test('ignores tool, step and status events so they keep the existing reload path', () => {
  const tool = { type: 'session.tool.progress', data: { ...base, id: 'tool_1', metadata: {} } };
  assert.equal(mapStreamEvent(tool), undefined);
  assert.equal(mapStreamEvent({ type: 'session.status', data: { ...base, status: { type: 'busy' } } }), undefined);
});

test('starts a fresh reply when the assistant message changes', () => {
  const first = mapStreamEvent({ type: 'session.text.delta', data: { ...base, delta: 'one' } })!;
  const second = mapStreamEvent({ type: 'session.text.delta', data: { ...base, assistantMessageID: 'msg_2', delta: 'two' } })!;
  assert.equal(first.messageId, 'msg_1');
  assert.equal(second.messageId, 'msg_2');
});

test('requires a session and assistant message identifier', () => {
  assert.equal(mapStreamEvent({ type: 'session.text.delta', data: { sessionID: 'ses_1', delta: 'x' } }), undefined);
  assert.equal(mapStreamEvent({ type: 'session.text.delta', data: { ...base, delta: 7 } }), undefined);
  assert.equal(mapStreamEvent({ type: 'session.text.delta' }), undefined);
});
