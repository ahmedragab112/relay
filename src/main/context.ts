import type { ContextBlock } from '../shared/contracts.js';
import { text } from './security.js';

export const MAX_CONTEXT_BLOCKS = 6;
export const CONTEXT_BLOCK_LIMIT = 8000;
export const CONTEXT_TOTAL_LIMIT = 20_000;

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
