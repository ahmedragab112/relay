import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { StageAttachmentInput, StagedAttachment } from '../shared/contracts.js';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_NAME = 120;

/** Keeps the name safe for the project folder while leaving the extension readable. */
export function attachmentName(value: string): string {
  const base = value.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[:*?"<>|]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'attachment').slice(0, MAX_NAME);
}

async function readInput(input: StageAttachmentInput): Promise<{ bytes: Buffer; name: string }> {
  if (typeof input.path === 'string' && input.path) {
    if (!isAbsolute(input.path) || input.path.includes('\0')) throw new Error('Attach files from Finder or the file picker.');
    const info = await stat(input.path);
    if (!info.isFile()) throw new Error('Folders cannot be attached. Choose files instead.');
    if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be smaller than 2 MB.');
    return { bytes: await readFile(input.path), name: attachmentName(input.name || input.path) };
  }
  if (typeof input.text === 'string') {
    return { bytes: Buffer.from(input.text, 'utf8'), name: attachmentName(input.name || 'pasted-text.txt') };
  }
  if (typeof input.data === 'string') {
    return { bytes: Buffer.from(input.data, 'base64'), name: attachmentName(input.name || 'attachment') };
  }
  throw new Error('Nothing to attach.');
}

async function writeUnique(directory: string, name: string, bytes: Buffer): Promise<string> {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length) || 'attachment';
  for (let index = 1; index <= 200; index++) {
    const candidate = join(directory, index === 1 ? name : `${stem}-${index}${extension}`);
    try {
      const existing = await readFile(candidate);
      if (existing.equals(bytes)) return candidate;
    } catch {
      try {
        await writeFile(candidate, bytes, { mode: 0o600, flag: 'wx' });
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  }
  throw new Error('There are too many attachments with this name. Rename the file and try again.');
}

/** Copies or writes an attachment into `.relay/attachments` inside the open project. */
export async function stageAttachment(root: string, input: StageAttachmentInput): Promise<StagedAttachment> {
  const { bytes, name } = await readInput(input);
  if (!bytes.length) throw new Error('This file is empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be smaller than 2 MB.');
  const directory = join(root, '.relay', 'attachments');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = await writeUnique(directory, name, bytes);
  return { path: `.relay/attachments/${basename(target)}`, name, size: bytes.length };
}
