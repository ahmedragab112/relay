export function text(value: unknown, name: string, maximum = 16_384): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw new Error(`${name} must be text of at most ${maximum} characters.`);
  }
  return value;
}

export function identifier(value: unknown): string {
  const id = text(value, 'Identifier', 256);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid identifier.');
  return id;
}

export function isTrustedRenderer(actual: string, expected: string, mainFrame: boolean): boolean {
  if (!mainFrame) return false;
  try {
    const source = new URL(actual);
    const target = new URL(expected);
    source.hash = '';
    target.hash = '';
    return source.href === target.href;
  } catch {
    return false;
  }
}

export function validateExternalURL(value: unknown): string {
  const url = new URL(text(value, 'URL', 4096));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be opened.');
  if (url.username || url.password) throw new Error('URLs cannot contain credentials.');
  return url.href;
}

export function validateEndpoint(value: unknown): string {
  const url = new URL(text(value, 'URL', 4096));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Use an HTTPS URL, or HTTP for a localhost model server.');
  }
  if (url.username || url.password) throw new Error('Put credentials in the API key field, not the URL.');
  if (url.hash) throw new Error('An endpoint URL cannot contain a fragment.');
  return url.href.replace(/\/$/, '');
}

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || Number(cols) < 2 || Number(cols) > 500 || Number(rows) < 1 || Number(rows) > 300) {
    throw new Error('Invalid terminal dimensions.');
  }
  return { cols: Number(cols), rows: Number(rows) };
}
