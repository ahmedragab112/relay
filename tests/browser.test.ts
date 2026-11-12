import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress } from '../src/renderer/browser.js';

test('browser address accepts web pages and shorthand hosts', () => {
  assert.equal(normalizeAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeAddress('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
  assert.equal(normalizeAddress('http://localhost:8000/app'), 'http://localhost:8000/app');
  assert.equal(normalizeAddress('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeAddress('127.0.0.1:8080/x'), 'https://127.0.0.1:8080/x');
});

test('browser address rejects non-web and credential URLs', () => {
  assert.equal(normalizeAddress(''), undefined);
  assert.equal(normalizeAddress('   '), undefined);
  assert.equal(normalizeAddress('javascript:alert(1)'), undefined);
  assert.equal(normalizeAddress('data:text/html,hello'), undefined);
  assert.equal(normalizeAddress('file:///etc/passwd'), undefined);
  assert.equal(normalizeAddress('about:blank'), undefined);
  assert.equal(normalizeAddress('https://user:secret@example.com'), undefined);
});
