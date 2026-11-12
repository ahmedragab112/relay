import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface PluginDownload {
  path: string;
  directory: string;
  digest: string;
}

export interface DownloadOptions {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
  subject?: string;
}

export function validateImportURL(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a plugin ZIP URL.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new Error('Plugin imports must use HTTPS.');
  if (url.username || url.password) throw new Error('Remove credentials from the plugin URL.');
  if (!url.hostname) throw new Error('Enter a valid HTTPS URL.');
  return url.toString();
}

export function validateDigest(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.trim())) throw new Error('A SHA-256 hash must be 64 hex characters.');
  return value.trim().toLowerCase();
}

export async function downloadPluginPackage(value: unknown, digestValue: unknown, options: DownloadOptions = {}): Promise<PluginDownload> {
  let current = validateImportURL(value);
  const expected = validateDigest(digestValue);
  const request = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  const subject = options.subject ?? 'plugin ZIP';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? IMPORT_TIMEOUT_MS);
  try {
    let redirects = 0;
    while (true) {
      const response = await request(current, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/zip,application/octet-stream;q=0.9,*/*;q=0.1' } });
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('The download redirected without a destination.');
        if (++redirects > MAX_REDIRECTS) throw new Error('The download redirected too many times.');
        let next: URL;
        try { next = new URL(location, current); } catch { throw new Error('The download redirected to an invalid address.'); }
        current = validateImportURL(next.toString());
        continue;
      }
      if (!response.ok) throw new Error(`The download failed with HTTP ${response.status}.`);
      if (!response.body) throw new Error('The download returned no data.');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`The ${subject} is larger than 20 MB.`);
      const hash = createHash('sha256');
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`The ${subject} is larger than 20 MB.`);
        }
        hash.update(value);
        chunks.push(value);
      }
      if (!total) throw new Error('The download was empty.');
      const digest = hash.digest('hex');
      if (expected && digest !== expected) throw new Error(`The SHA-256 hash does not match. Received ${digest}.`);
      const directory = await mkdtemp(join(tmpdir(), 'relay-plugin-import-'));
      const path = join(directory, 'plugin.zip');
      await writeFile(path, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), { mode: 0o600 });
      return { path, directory, digest };
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The download timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
