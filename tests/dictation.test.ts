import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, transcriptionTarget, validateAudio } from '../src/main/dictation.js';
import type { ProviderInput } from '../src/shared/contracts.js';

const groq: ProviderInput[] = [{ id: 'groq', apiKey: 'test-key' }];

test('audio validation enforces formats and size', () => {
  const audio = validateAudio({ mime: 'audio/webm;codecs=opus', data: new Uint8Array([1, 2, 3]).buffer });
  assert.equal(audio.mime, 'audio/webm');
  assert.equal(audio.extension, 'webm');
  assert.equal(audio.data.length, 3);
  assert.throws(() => validateAudio({ mime: 'video/mp4', data: new ArrayBuffer(2) }), /format/i);
  assert.throws(() => validateAudio({ mime: 'audio/webm', data: new ArrayBuffer(0) }), /empty/i);
  assert.throws(() => validateAudio({ mime: 'audio/webm', data: new ArrayBuffer(26 * 1024 * 1024) }), /25 MB/);
  assert.throws(() => validateAudio(undefined), /No recording/i);
});

test('transcription targets resolve provider endpoints without leaking keys into URLs', () => {
  const target = transcriptionTarget({ provider: 'groq', model: 'whisper-large-v3-turbo' }, groq);
  assert.equal(target.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(target.key, 'test-key');
  assert.equal(target.model, 'whisper-large-v3-turbo');
  assert.equal(transcriptionTarget({ provider: 'openai', model: 'whisper-1' }, [{ id: 'openai', apiKey: 'k' }]).url, 'https://api.openai.com/v1/audio/transcriptions');
  const local = transcriptionTarget({ provider: 'custom', model: 'whisper-1' }, [{ id: 'custom', baseURL: 'http://localhost:8080/v1', models: ['whisper-1'] }]);
  assert.equal(local.url, 'http://localhost:8080/v1/audio/transcriptions');
  assert.equal(local.key, undefined);
  assert.throws(() => transcriptionTarget({ provider: 'groq', model: 'whisper-1' }, [{ id: 'groq' }]), /API key/i);
  assert.throws(() => transcriptionTarget({ provider: 'groq', model: '  ' }, groq), /model/i);
  assert.throws(() => transcriptionTarget({ provider: 'google', model: 'gemini' }, [{ id: 'google', apiKey: 'k' }]), /does not offer/i);
  assert.throws(() => transcriptionTarget({ provider: 'groq', model: 'whisper-1' }, []), /Add Groq/i);
});

test('transcription posts multipart audio and returns trimmed text', async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ text: '  Open the settings panel.  ' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const text = await transcribe({ url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: 'test-key', model: 'whisper-large-v3-turbo' }, { mime: 'audio/webm', extension: 'webm', data: Buffer.from([1, 2, 3]) }, fake);
  assert.equal(text, 'Open the settings panel.');
  assert.equal(captured?.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  const headers = captured?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer test-key');
  const form = captured?.init?.body as FormData;
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  const file = form.get('file') as File;
  assert.equal(file.type, 'audio/webm');
  assert.equal(file.name, 'dictation.webm');
});

test('transcription surfaces provider errors and empty results', async () => {
  const failing = (async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(() => transcribe({ url: 'https://example.com/audio/transcriptions', model: 'whisper-1' }, { mime: 'audio/webm', extension: 'webm', data: Buffer.from([1]) }, failing), /401.*invalid api key/i);
  const silent = (async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => transcribe({ url: 'https://example.com/audio/transcriptions', model: 'whisper-1' }, { mime: 'audio/webm', extension: 'webm', data: Buffer.from([1]) }, silent), /no text/i);
});
