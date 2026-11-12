import type { ChatMessage, ToolPart } from '../shared/contracts';

export interface MessageGroup {
  id: string;
  role: ChatMessage['role'];
  createdAt: number;
  startedAt: number;
  completedAt?: number;
  tokens: number;
  cost: number;
  messages: ChatMessage[];
}

export type ReplyBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; part: ToolPart };

// The engine records one assistant message per step, so a single turn can arrive as many messages.
export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let lastUserAt: number | undefined;
  for (const message of messages) {
    if (message.role === 'user') lastUserAt = message.createdAt;
    const last = groups[groups.length - 1];
    if (message.role === 'assistant' && last?.role === 'assistant') {
      last.messages.push(message);
      addTiming(last, message);
      continue;
    }
    const startedAt = message.role === 'assistant' ? lastUserAt ?? message.createdAt : message.createdAt;
    groups.push({ id: message.id, role: message.role, createdAt: message.createdAt, startedAt, tokens: 0, cost: 0, messages: [message] });
    addTiming(groups[groups.length - 1], message);
  }
  return groups;
}

function addTiming(group: MessageGroup, message: ChatMessage): void {
  if (message.completedAt !== undefined) group.completedAt = Math.max(group.completedAt ?? 0, message.completedAt);
  group.tokens += message.tokens ?? 0;
  group.cost += message.cost ?? 0;
}

export function lastAssistantIndex(groups: MessageGroup[]): number {
  for (let index = groups.length - 1; index >= 0; index--) if (groups[index].role === 'assistant') return index;
  return -1;
}

export function replyBlocks(group: MessageGroup): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let pending: { kind: 'text' | 'reasoning'; id: string; text: string } | undefined;
  const flush = () => {
    if (!pending) return;
    blocks.push({ ...pending });
    pending = undefined;
  };
  for (const message of group.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool') { flush(); blocks.push({ kind: 'tool', part }); continue; }
      if (part.type !== 'text' && part.type !== 'reasoning') continue;
      if (pending?.kind === part.type) pending.text = [pending.text, part.text].filter(Boolean).join('\n\n');
      else { flush(); pending = { kind: part.type, id: part.id, text: part.text }; }
    }
  }
  flush();
  return blocks;
}

export function groupText(group: MessageGroup): string {
  return replyBlocks(group)
    .flatMap((block) => block.kind === 'text' ? [block.text.trim()] : [])
    .filter(Boolean)
    .join('\n\n');
}
