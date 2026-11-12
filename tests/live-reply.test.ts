import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendStream, liveReplyText, type LiveReply } from '../src/renderer/live-reply.js';

const stream = (overrides: Partial<Parameters<typeof appendStream>[1]> = {}) => ({
  messageId: 'msg_1',
  kind: 'text' as const,
  ordinal: 0,
  text: 'Hello',
  ended: false,
  ...overrides,
});

test('starts a live reply from the first delta', () => {
  const live = appendStream(undefined, stream());
  assert.equal(live.messageId, 'msg_1');
  assert.deepEqual(live.segments.map(segment => [segment.kind, segment.text]), [['text', 'Hello']]);
});

test('appends deltas to the same segment in arrival order', () => {
  let live: LiveReply | undefined = appendStream(undefined, stream());
  live = appendStream(live, stream({ text: ' world' }));
  live = appendStream(live, stream({ text: '!' }));
  assert.equal(live.segments.length, 1);
  assert.equal(live.segments[0].text, 'Hello world!');
  assert.equal(liveReplyText(live), 'Hello world!');
});

test('keeps reasoning and answer text as separate segments', () => {
  let live = appendStream(undefined, stream({ kind: 'reasoning', text: 'Plan' }));
  live = appendStream(live, stream({ kind: 'reasoning', text: 'ning' }));
  live = appendStream(live, stream({ kind: 'text', text: 'Result' }));
  assert.deepEqual(live.segments.map(segment => [segment.kind, segment.text]), [['reasoning', 'Planning'], ['text', 'Result']]);
});

test('replaces the accumulated text when a segment ends', () => {
  let live = appendStream(undefined, stream());
  live = appendStream(live, stream({ text: ' there', ended: false }));
  live = appendStream(live, stream({ text: 'Hello there', ended: true }));
  assert.equal(live.segments[0].text, 'Hello there');
  assert.equal(live.segments[0].ended, true);
  assert.equal(liveReplyText(live), 'Hello there');
});

test('tracks ordinals independently inside one assistant message', () => {
  let live = appendStream(undefined, stream({ ordinal: 0, text: 'first' }));
  live = appendStream(live, stream({ ordinal: 2, text: 'second' }));
  live = appendStream(live, stream({ ordinal: 0, text: ' step' }));
  assert.deepEqual(live.segments.map(segment => [segment.ordinal, segment.text]), [[0, 'first step'], [2, 'second']]);
});

test('discards the previous reply when the assistant message id changes', () => {
  const previous = appendStream(undefined, stream({ text: 'old' }));
  const live = appendStream(previous, stream({ messageId: 'msg_2', text: 'new' }));
  assert.equal(live.messageId, 'msg_2');
  assert.deepEqual(live.segments.map(segment => segment.text), ['new']);
});

test('reports answer text only, never reasoning', () => {
  let live = appendStream(undefined, stream({ kind: 'reasoning', text: 'hidden' }));
  live = appendStream(live, stream({ kind: 'text', text: 'shown' }));
  assert.equal(liveReplyText(live), 'shown');
});
