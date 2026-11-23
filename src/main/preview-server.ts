import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface PreviewFile {
  body: Buffer | string;
  type: string;
}

export interface PreviewServer {
  /** Loopback base with its access token, e.g. http://127.0.0.1:4321/<token>. */
  url: string;
  close(): Promise<void>;
}

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** Read-only loopback server so the design agent's browser can open the preview. */
export async function startPreviewServer(serve: (path: string) => Promise<PreviewFile | undefined>): Promise<PreviewServer> {
  const token = randomBytes(12).toString('hex');
  const prefix = `/${token}/`;
  const server = createServer(async (request, response) => {
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) {
      response.writeHead(405, { ...HEADERS, allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname: string;
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith(prefix)) { response.writeHead(404, HEADERS); response.end(); return; }
      pathname = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      response.writeHead(400, HEADERS);
      response.end();
      return;
    }
    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length || pathname.includes('\\') || pathname.includes('\0')
      || segments.some((part) => part === '.' || part === '..')) {
      response.writeHead(404, HEADERS);
      response.end();
      return;
    }
    const file = await serve(segments.join('/')).catch(() => undefined);
    if (!file) { response.writeHead(404, HEADERS); response.end(); return; }
    response.writeHead(200, { ...HEADERS, 'content-type': file.type });
    response.end(head ? undefined : file.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/${token}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
