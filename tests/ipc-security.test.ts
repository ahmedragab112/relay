import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedRenderer, validateExternalURL, text, identifier } from '../src/main/security.js';

test('IPC accepts only the expected main frame and renderer document', () => {
  assert.equal(isTrustedRenderer('file:///app/dist/renderer/index.html', 'file:///app/dist/renderer/index.html', true), true);
  assert.equal(isTrustedRenderer('file:///etc/passwd', 'file:///app/dist/renderer/index.html', true), false);
  assert.equal(isTrustedRenderer('file:///app/dist/renderer/index.html', 'file:///app/dist/renderer/index.html', false), false);
  assert.equal(isTrustedRenderer('http://127.0.0.1:5178/', 'http://127.0.0.1:5178/', true), true);
  assert.equal(isTrustedRenderer('http://evil.test/', 'http://127.0.0.1:5178/', true), false);
});

test('external links and untrusted scalar IPC inputs are bounded', () => {
  assert.equal(validateExternalURL('https://example.com/docs'), 'https://example.com/docs');
  assert.throws(() => validateExternalURL('javascript:alert(1)'), /HTTP/i);
  assert.throws(() => validateExternalURL('file:///etc/passwd'), /HTTP/i);
  assert.throws(() => text(42, 'Message'), /Message/);
  assert.throws(() => text('x'.repeat(6), 'Message', 5), /Message/);
  assert.throws(() => identifier('../escape'), /identifier/i);
  assert.equal(identifier('session_abc123'), 'session_abc123');
});
