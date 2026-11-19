import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_BRIEF, MOTION_ENTRY, MOTION_ROOT, injectMotionRuntime, isMotionSlug, motionEvent, motionExportName,
  motionFrameCount, motionPrompt, motionSessionTitle, motionSlug, motionTitle,
} from '../src/shared/motion.js';

test('motion names become safe folders and readable titles', () => {
  assert.equal(motionSlug('Product Launch — Hero!'), 'product-launch-hero');
  assert.equal(motionTitle('product-launch-hero'), 'Product launch hero');
  assert.equal(isMotionSlug('product-launch-hero'), true);
  assert.equal(isMotionSlug('../escape'), false);
  assert.throws(() => motionSlug('***'), /letters or numbers/);
  assert.equal(motionSessionTitle('product-launch-hero'), 'Motion · Product launch hero');
});

test('the prompt plans Motion.md before code and fixes the scene contract', () => {
  const prompt = motionPrompt({
    projectName: 'Shop', slug: 'launch', stage: 'portrait', existing: [], revision: false, request: 'A launch teaser',
  });
  assert.ok(prompt.includes('motion director'));
  assert.ok(prompt.includes(`${MOTION_ROOT}/launch/${MOTION_BRIEF}`));
  assert.ok(prompt.includes('window.motionScene'));
  assert.ok(prompt.includes('update(t)'));
  assert.ok(prompt.includes('1080x1920'));
  assert.ok(prompt.includes('Date.now'));
  assert.ok(prompt.includes('requestAnimationFrame'));
  assert.ok(prompt.includes('No CDN'));
  assert.ok(prompt.includes('A launch teaser'));
  assert.ok(prompt.includes('reply with two or three sentences'));
});

test('a motion revision reads the brief and current files before editing', () => {
  const prompt = motionPrompt({
    projectName: 'Shop', slug: 'launch', stage: 'landscape', existing: [MOTION_ENTRY, 'scene.js'],
    revision: true, request: 'Slower ending',
  });
  assert.ok(prompt.includes('Revise the existing motion'));
  assert.ok(prompt.includes(`Read ${MOTION_ROOT}/launch/${MOTION_BRIEF}`));
  assert.ok(prompt.includes(MOTION_ENTRY));
  assert.ok(prompt.includes('1920x1080'));
  assert.ok(prompt.includes('Slower ending'));
});

test('the runtime injects once and answers the studio commands', () => {
  const page = '<!doctype html><html><body><script src="scene.js"></script></body></html>';
  const once = injectMotionRuntime(page);
  assert.ok(once.includes('relay-motion-runtime'));
  assert.ok(once.includes('relayMotionCommand'));
  assert.ok(once.includes('relayMotionSeek'));
  assert.equal(injectMotionRuntime(once), once);
});

test('only well-formed motion messages reach the studio', () => {
  assert.deepEqual(motionEvent({ relayMotion: 1, type: 'info', duration: 6 }), { type: 'info', duration: 6 });
  assert.deepEqual(motionEvent({ relayMotion: 1, type: 'time', time: 2.5, playing: true }), { type: 'time', time: 2.5, playing: true });
  assert.deepEqual(motionEvent({ relayMotion: 1, type: 'time', time: -3, playing: false }), { type: 'time', time: 0, playing: false });
  assert.equal(motionEvent({ relayMotion: 1, type: 'info', duration: 'x' }), null);
  assert.equal(motionEvent({ relayMotion: 1, type: 'time', time: Infinity }), null);
  assert.equal(motionEvent({ relayPreview: 1 }), null);
  assert.equal(motionEvent(null), null);
});

test('an export renders whole frames and names the file from the slug and time', () => {
  assert.equal(motionFrameCount(6), 180);
  assert.equal(motionFrameCount(1.01, 30), 30);
  assert.equal(motionFrameCount(0.01), 1);
  assert.throws(() => motionFrameCount(0), /has no duration/);
  assert.throws(() => motionFrameCount(Number.NaN), /has no duration/);
  assert.throws(() => motionFrameCount(300), /too long/);
  assert.equal(motionExportName('product-launch', new Date(2026, 10, 19, 14, 5, 3)), 'product-launch-20261119-140503.mp4');
});
