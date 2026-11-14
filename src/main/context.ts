import type { ContextBlock } from '../shared/contracts.js';
import { text } from './security.js';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_CONTEXT_BLOCKS = 6;
export const CONTEXT_BLOCK_LIMIT = 8000;
export const CONTEXT_TOTAL_LIMIT = 20_000;
export const INSTRUCTION_FILE_LIMIT = 16_000;

export const PROJECT_INSTRUCTION_FILES = ['RELAY.md', 'AGENTS.md', 'CLAUDE.md', '.relay.md'] as const;

/** Read the highest-priority project instructions file, if any, capped to INSTRUCTION_FILE_LIMIT. */
export async function loadProjectInstructions(directory: string): Promise<{ label: string; text: string } | undefined> {
  if (!directory) return undefined;
  for (const name of PROJECT_INSTRUCTION_FILES) {
    const path = join(directory, name);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 256 * 1024) continue;
      const contents = (await readFile(path, 'utf8')).trim();
      if (!contents) continue;
      const body = contents.length > INSTRUCTION_FILE_LIMIT ? `${contents.slice(0, INSTRUCTION_FILE_LIMIT)}\n(truncated)` : contents;
      return { label: name, text: body };
    } catch { /* try the next filename */ }
  }
  return undefined;
}

export function composeMessage(message: string, context: ContextBlock[]): string {
  const body = text(message, 'Message', 32_000).trim();
  if (!body) throw new Error('Write a message before sending.');
  const blocks: string[] = [];
  let used = 0;
  for (const block of context.slice(0, MAX_CONTEXT_BLOCKS)) {
    if (!block || typeof block.label !== 'string' || typeof block.text !== 'string') throw new Error('Context tags must include a label and text.');
    const label = block.label.replace(/\s+/g, ' ').trim().slice(0, 80);
    let contents = block.text.trim();
    if (!label || !contents) continue;
    if (contents.length > CONTEXT_BLOCK_LIMIT) contents = `${contents.slice(0, CONTEXT_BLOCK_LIMIT)}\n(truncated)`;
    if (used + contents.length > CONTEXT_TOTAL_LIMIT) break;
    used += contents.length;
    blocks.push(`[Context from ${label}]\n${contents}`);
  }
  return blocks.length ? `${body}\n\n${blocks.join('\n\n')}` : body;
}
