import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDesignPage, designPageFile, designPageTitle } from '../src/shared/design.js';
import { Designs, type DesignDeps } from '../src/main/design.js';

const project = (path: string): DesignDeps['project'] => () => ({ id: 'p', name: 'Shop', path });

function designsAt(path: string): Designs {
  return new Designs({
    project: project(path),
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async () => undefined,
      abortSession: async () => undefined,
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'full',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  });
}

async function canvasProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-canvas-'));
  const dir = join(root, '.relay/design/checkout');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><head><title>Checkout</title></head><body><h1>Pay</h1></body></html>');
  await writeFile(join(dir, 'about.html'), '<html><head><title>About the shop</title></head><body><p>Hello</p></body></html>');
  await writeFile(join(dir, 'styles.css'), 'body{margin:0}');
  await mkdir(join(dir, 'versions/1'), { recursive: true });
  await writeFile(join(dir, 'versions/1/index.html'), '<h1>Old</h1>');
  return root;
}

test('page names become safe html files', () => {
  assert.equal(designPageFile('About us'), 'about-us.html');
  assert.equal(designPageFile('Pricing.html'), 'pricing.html');
  assert.equal(designPageFile('Équipe  2'), 'equipe-2.html');
  assert.throws(() => designPageFile('   '));
  assert.throws(() => designPageFile('versions'));
});

test('page titles come from the title tag with a readable fallback', () => {
  assert.equal(designPageTitle('index.html', '<head><title> Checkout  flow </title></head>'), 'Checkout flow');
  assert.equal(designPageTitle('index.html', '<html></html>'), 'Home');
  assert.equal(designPageTitle('about-us.html', ''), 'About Us');
  assert.ok(designPageTitle('index.html', `<title>${'x'.repeat(200)}</title>`).length <= 80);
});

test('saving a page strips the injected preview layer', () => {
  const html = [
    '<!doctype html><html><head>',
    '<style id="relay-design-system">:root{--ds-text:#fff}</style>',
    '<style id="relay-preview-motion">@view-transition{navigation:auto}</style>',
    '<style id="relay-pick-style">#relay-pick-box{}</style>',
    '<title>Checkout</title></head><body>',
    '<main contenteditable="true"><h1>Pay</h1></main>',
    '<div id="relay-pick-box" style="display:none"></div>',
    '<div id="relay-pick-tag"></div>',
    '<script id="relay-preview-runtime">(function(){})();</script>',
    '</body></html>',
  ].join('');
  const clean = cleanDesignPage(html);
  assert.ok(clean.startsWith('<!doctype html>'));
  assert.match(clean, /<h1>Pay<\/h1>/);
  assert.match(clean, /<title>Checkout<\/title>/);
  for (const marker of ['relay-design-system', 'relay-preview-runtime', 'relay-preview-motion', 'relay-pick-style', 'relay-pick-box', 'relay-pick-tag', 'contenteditable']) {
    assert.ok(!clean.includes(marker), marker);
  }
});

test('cleanDesignPage adds a doctype when a page has none', () => {
  const clean = cleanDesignPage('<html><body><p>Hi</p></body></html>');
  assert.ok(clean.startsWith('<!doctype html>'));
  assert.match(clean, /<p>Hi<\/p>/);
});

test('pages list every html screen, index first', async () => {
  const root = await canvasProject();
  try {
    const pages = await designsAt(root).pages('checkout');
    assert.deepEqual(pages, [
      { file: 'index.html', name: 'Checkout' },
      { file: 'about.html', name: 'About the shop' },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('adding an artboard writes a themed page and saves a version', async () => {
  const root = await canvasProject();
  try {
    const designs = designsAt(root);
    await designs.addPage('checkout', 'Order status');
    const file = join(root, '.relay/design/checkout/order-status.html');
    const html = await readFile(file, 'utf8');
    assert.ok(html.includes('--ds-'));
    assert.match(html, /Order status/);
    const pages = await designs.pages('checkout');
    assert.deepEqual(pages.map((page) => page.file), ['index.html', 'about.html', 'order-status.html']);
    const version = (await readdir(join(root, '.relay/design/checkout/versions'))).sort();
    assert.deepEqual(version, ['1', '2']);
    await assert.rejects(designs.addPage('checkout', 'About'), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saving direct edits snapshots first and keeps the page clean', async () => {
  const root = await canvasProject();
  try {
    const designs = designsAt(root);
    const saved = await designs.savePage('checkout', 'about.html', '<!doctype html><html><body><h1>Hello</h1><script id="relay-preview-runtime">x()</script></body></html>');
    assert.ok(saved.designs.length);
    const text = await readFile(join(root, '.relay/design/checkout/about.html'), 'utf8');
    assert.match(text, /<h1>Hello<\/h1>/);
    assert.ok(!text.includes('relay-preview-runtime'));
    const versions = (await readdir(join(root, '.relay/design/checkout/versions'))).sort();
    assert.deepEqual(versions, ['1', '2']);
    const old = await readFile(join(root, '.relay/design/checkout/versions/2/about.html'), 'utf8');
    assert.match(old, /Hello/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saving edits refuses unknown pages, other files and huge pages', async () => {
  const root = await canvasProject();
  try {
    const designs = designsAt(root);
    await assert.rejects(designs.savePage('checkout', 'missing.html', '<h1>x</h1>'), /not part/i);
    await assert.rejects(designs.savePage('checkout', 'styles.css', 'body{}'), /not part/i);
    await assert.rejects(designs.savePage('checkout', 'index.html', `<p>${'x'.repeat(600 * 1024)}</p>`), /too large|too big/i);
    await assert.rejects(designs.savePage('checkout', 'index.html', '   '), /empty/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copying a page takes the requested screen', async () => {
  const root = await canvasProject();
  try {
    const designs = designsAt(root);
    assert.deepEqual(await designs.code('checkout', 'about.html'), {
      name: 'about.html',
      text: '<html><head><title>About the shop</title></head><body><p>Hello</p></body></html>',
    });
    await assert.rejects(designs.code('checkout', 'styles.css'), /no page|not part/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
