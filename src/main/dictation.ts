import type { DictationSettings, ProviderInput } from '../shared/contracts.js';
import { providerName, providerPreset } from '../shared/providers.js';
import { validateEndpoint } from './security.js';

const maximumBytes = 25 * 1024 * 1024;
const audioExtensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

// Only providers exposing an OpenAI-compatible /audio/transcriptions route.
const transcriptionProviders = new Set(['groq', 'openai', 'custom', 'lmstudio', 'llamacpp']);

export interface AudioPayload {
  mime: string;
  extension: string;
  data: Buffer;
}

export interface TranscriptionTarget {
  url: string;
  key?: string;
  model: string;
}

export function validateAudio(value: unknown): AudioPayload {
  if (!value || typeof value !== 'object') throw new Error('No recording was received.');
  const input = value as { mime?: unknown; data?: unknown };
  const mime = typeof input.mime === 'string' ? input.mime.split(';')[0].trim().toLowerCase() : '';
  const extension = audioExtensions[mime];
  if (!extension) throw new Error('This recording format is not supported.');
  const raw = input.data;
  if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) throw new Error('No recording was received.');
  const data = raw instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(raw))
    : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (!data.length) throw new Error('The recording was empty.');
  if (data.length > maximumBytes) throw new Error('Recordings must be 25 MB or smaller.');
  return { mime, extension, data };
}

export function transcriptionTarget(settings: DictationSettings, providers: ProviderInput[]): TranscriptionTarget {
  if (!transcriptionProviders.has(settings.provider)) throw new Error(`${providerName(settings.provider)} does not offer voice transcription. Choose Groq, OpenAI, or a compatible endpoint.`);
  const provider = providers.find((item) => item.id === settings.provider);
  if (!provider) throw new Error(`Add ${providerName(settings.provider)} in Settings before using voice dictation.`);
  const base = provider.baseURL ?? providerPreset(provider.id)?.baseURL ?? (provider.id === 'openai' ? 'https://api.openai.com/v1' : undefined);
  if (!base) throw new Error(`${providerName(settings.provider)} needs a base URL for voice dictation.`);
  const endpoint = validateEndpoint(base);
  const model = settings.model.trim();
  if (!model) throw new Error('Choose a transcription model in Settings.');
  const parsed = new URL(endpoint);
  const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!provider.apiKey && !local) throw new Error(`${providerName(settings.provider)} needs an API key for voice dictation.`);
  return { url: `${endpoint}/audio/transcriptions`, key: provider.apiKey, model };
}

export async function transcribe(target: TranscriptionTarget, audio: AudioPayload, fetchImpl: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([audio.data as unknown as BlobPart], { type: audio.mime }), `dictation.${audio.extension}`);
  form.append('model', target.model);
  let response: Response;
  try {
    response = await fetchImpl(target.url, {
      method: 'POST',
      headers: target.key ? { authorization: `Bearer ${target.key}` } : {},
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === 'TimeoutError' ? 'The transcription request timed out.' : 'The transcription service could not be reached.';
    throw new Error(detail);
  }
  const body = (await response.text()).slice(0, 64 * 1024);
  if (!response.ok) {
    let reason = '';
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
      reason = typeof parsed.error === 'string' ? parsed.error : typeof parsed.error?.message === 'string' ? parsed.error.message : typeof parsed.message === 'string' ? parsed.message : '';
    } catch { reason = body; }
    throw new Error(`Transcription failed (${response.status}): ${reason.trim().slice(0, 300) || response.statusText || 'no detail provided'}`);
  }
  let text = '';
  try {
    const parsed = JSON.parse(body) as { text?: unknown };
    if (typeof parsed.text === 'string') text = parsed.text;
  } catch { text = body; }
  const clean = text.trim();
  if (!clean) throw new Error('The transcription service returned no text.');
  return clean.slice(0, 20_000);
}
