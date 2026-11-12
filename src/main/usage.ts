import type { SessionMessageInfo, TokenUsageInfo } from '@opencode/client';
import type { UsageSummary } from '../shared/contracts.js';
import { totalWorked, type TurnTimingMessage } from '../shared/turns.js';

const emptyTokens = (): TokenUsageInfo => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });

function addTokens(total: TokenUsageInfo, used: TokenUsageInfo | undefined): void {
  if (!used) return;
  total.input += used.input;
  total.output += used.output;
  total.reasoning += used.reasoning;
  total.cache.read += used.cache.read;
  total.cache.write += used.cache.write;
}

export function tokenTotal(used: TokenUsageInfo): number {
  return used.input + used.output + used.reasoning + used.cache.read + used.cache.write;
}

function timing(message: SessionMessageInfo): TurnTimingMessage {
  if (message.type === 'assistant') {
    return { role: 'assistant', createdAt: message.time.created,
      ...(message.time.completed === undefined ? {} : { completedAt: message.time.completed }) };
  }
  return { role: message.type === 'user' ? 'user' : 'system', createdAt: message.time.created };
}

export function summarizeUsage(messages: SessionMessageInfo[], contextLimit?: number): UsageSummary {
  let lastCompaction = -1;
  let compactions = 0;
  const totals = emptyTokens();
  let cost = 0;

  messages.forEach((message, index) => {
    if (message.type === 'compaction') {
      if (message.status === 'completed') {
        compactions++;
        lastCompaction = index;
        addTokens(totals, message.tokens);
      }
      if (message.status !== 'running') cost += message.cost ?? 0;
      return;
    }
    if (message.type !== 'assistant') return;
    addTokens(totals, message.tokens);
    cost += message.cost ?? 0;
  });

  let model: string | undefined;
  let contextUsed = 0;
  for (let index = messages.length - 1; index > lastCompaction; index--) {
    const message = messages[index];
    if (message.type !== 'assistant' || !message.tokens) continue;
    contextUsed = tokenTotal(message.tokens);
    const id = message.model.id.includes('::') ? message.model.id.split('::').pop()! : message.model.id;
    model = `${message.model.providerID} · ${id}`;
    break;
  }

  const percent = contextLimit && contextLimit > 0 ? Math.min(100, Math.round((contextUsed / contextLimit) * 100)) : 0;
  return {
    input: totals.input, output: totals.output, reasoning: totals.reasoning,
    cacheRead: totals.cache.read, cacheWrite: totals.cache.write, total: tokenTotal(totals),
    contextUsed, contextLimit, percent, cost, compactions,
    worked: totalWorked(messages.map(timing)), ...(model ? { model } : {}),
  };
}
