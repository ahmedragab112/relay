import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillRegistry, SkillRegistry } from '../src/main/registry.js';

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(new TextEncoder().encode(body) as unknown as BodyInit, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

const entry = (name: string, url: string, extra: Record<string, unknown> = {}) => ({ name, description: `${name} description`, url, ...extra });

test('parses registry lists and object payloads into safe skill entries', () => {
  const list = parseSkillRegistry([
    entry('Visual Review', 'https://example.com/visual.zip'),
    entry('Release Notes', 'https://example.com/release.zip', { id: 'release-notes', sha256: 'A'.repeat(64) }),
  ]);
  assert.deepEqual(list, [
    { id: 'visual-review', name: 'Visual Review', description: 'Visual Review description', url: 'https://example.com/visual.zip' },
    { id: 'release-notes', name: 'Release Notes', description: 'Release Notes description', url: 'https://example.com/release.zip', sha256: 'a'.repeat(64) },
  ]);
  assert.equal(parseSkillRegistry({ skills: [entry('Docs', 'https://example.com/docs.md')] })[0].name, 'Docs');
});

test('registry entries without a name or HTTPS URL are skipped', () => {
  const list = parseSkillRegistry({
    skills: [
      entry('', 'https://example.com/no-name.zip'),
      entry('Insecure', 'http://example.com/insecure.zip'),
      entry('Bad hash', 'https://example.com/hash.zip', { sha256: 'nope' }),
      entry('Double', 'https://example.com/double.zip'),
      entry('Double again', 'https://example.com/double.zip'),
    ],
  });
  assert.deepEqual(list.map((skill) => skill.name), ['Double']);
});

test('a registry with no usable entries is rejected', () => {
  assert.throws(() => parseSkillRegistry({ skills: [] }), /no usable/i);
  assert.throws(() => parseSkillRegistry({ plugins: [] }), /JSON list/i);
  assert.throws(() => parseSkillRegistry('nope'), /JSON list/i);
});

test('the registry downloads over HTTPS only and caches entries until the TTL expires', async () => {
  let calls = 0;
  let now = 1_000;
  const registry = new SkillRegistry({
    now: () => now,
    ttlMs: 60_000,
    fetch: async () => {
      calls++;
      return response(JSON.stringify([entry('Review', 'https://example.com/review.zip')]));
    },
  });
  const first = await registry.list('https://example.com/registry.json');
  const second = await registry.list('https://example.com/registry.json');
  assert.equal(calls, 1);
  assert.equal(first[0].name, 'Review');
  assert.deepEqual(second, first);
  now += 61_000;
  await registry.list('https://example.com/registry.json');
  assert.equal(calls, 2);
  await assert.rejects(() => registry.list('http://example.com/registry.json'), /HTTPS/i);
  await assert.rejects(() => registry.list('https://user:pass@example.com/registry.json'), /credentials/i);
});

test('registry failures surface clearly and are not cached', async () => {
  let attempt = 0;
  const registry = new SkillRegistry({
    fetch: async () => {
      attempt++;
      return attempt === 1 ? response('missing', { status: 404 }) : response('not json');
    },
  });
  await assert.rejects(() => registry.list('https://example.com/registry.json'), /HTTP 404/);
  await assert.rejects(() => registry.list('https://example.com/registry.json'), /valid JSON/);
  assert.equal(attempt, 2);
});
