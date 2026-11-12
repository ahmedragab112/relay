import type { AppEvent } from '../shared/contracts.js';

export type StreamEvent = Extract<AppEvent, { type: 'session-stream' }>;

const KINDS = {
  'session.text.delta': { kind: 'text' as const, ended: false, field: 'delta' },
  'session.text.ended': { kind: 'text' as const, ended: true, field: 'text' },
  'session.reasoning.delta': { kind: 'reasoning' as const, ended: false, field: 'delta' },
  'session.reasoning.ended': { kind: 'reasoning' as const, ended: true, field: 'text' },
};

export function mapStreamEvent(event: { type: string; data?: unknown }): StreamEvent | undefined {
  const shape = KINDS[event.type as keyof typeof KINDS];
  if (!shape) return undefined;
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data.sessionID !== 'string' || typeof data.assistantMessageID !== 'string') return undefined;
  const text = data[shape.field];
  if (typeof text !== 'string') return undefined;
  return {
    type: 'session-stream',
    sessionId: data.sessionID,
    messageId: data.assistantMessageID,
    kind: shape.kind,
    ordinal: Number.isInteger(data.ordinal) ? data.ordinal as number : 0,
    text,
    ended: shape.ended,
  };
}
