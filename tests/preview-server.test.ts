import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreviewServer } from '../src/main/preview-server.js';

const serve = async (path: string) => path === 'checkout/index.html'
  ? { body: '<!doctype html><h1>Checkout</h1>', type: 'text/html; charset=utf-8' }
  : undefined;

test('the loopback preview serves design files behind its token', async () => {
  const server = await startPreviewServer(serve);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{24}$/);
    const response = await fetch(`${server.url}/checkout/index.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /Checkout/);
  } finally { await server.close(); }
});

test('the preview refuses paths without the token, traversal and unknown files', async () => {
  const server = await startPreviewServer(serve);
  try {
    const base = new URL(server.url);
    const noToken = `${base.origin}/checkout/index.html`;
    assert.equal((await fetch(noToken)).status, 404);
    assert.equal((await fetch(`${server.url}/checkout/%2e%2e/%2e%2e/secret`)).status, 404);
    assert.equal((await fetch(`${server.url}/checkout/..%2f..%2fsecret`)).status, 404);
    assert.equal((await fetch(`${server.url}/missing/index.html`)).status, 404);
    assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  } finally { await server.close(); }
});

test('a HEAD request carries headers without a body', async () => {
  const server = await startPreviewServer(serve);
  try {
    const response = await fetch(`${server.url}/checkout/index.html`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  } finally { await server.close(); }
});
