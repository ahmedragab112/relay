import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');

// The app root is a CSS grid; only the toolkit page owns the content area. A panel
// placed beside it becomes an auto-placed grid item with no height, so Atlas
// renders nothing at all — no button, no folder picker, no pages.
test('the Atlas panel sits inside the toolkit page', () => {
  const page = html.indexOf('<section id="tools-page"');
  const panel = html.indexOf('<div id="atlas-panel"');
  const end = html.indexOf('</section>', page);
  assert.ok(page >= 0 && panel >= 0 && end > page, 'the toolkit page and Atlas panel are both in the markup');
  assert.ok(panel > page && panel < end, 'the Atlas panel must be a child of the toolkit page, not a sibling grid item');
});

test('the Atlas toolbar can pick the project folder', () => {
  assert.match(html, /<select id="atlas-folder" aria-label="Atlas folder"><\/select>/);
});
