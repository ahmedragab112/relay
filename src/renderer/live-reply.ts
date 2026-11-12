export interface LiveSegment {
  kind: 'text' | 'reasoning';
  ordinal: number;
  text: string;
  ended: boolean;
}

export interface LiveReply {
  messageId: string;
  segments: LiveSegment[];
}

export interface StreamChunk {
  messageId: string;
  kind: 'text' | 'reasoning';
  ordinal: number;
  text: string;
  ended: boolean;
}

export function appendStream(live: LiveReply | undefined, chunk: StreamChunk): LiveReply {
  const next = { kind: chunk.kind, ordinal: chunk.ordinal, text: chunk.text, ended: chunk.ended };
  if (!live || live.messageId !== chunk.messageId) return { messageId: chunk.messageId, segments: [next] };
  const index = live.segments.findIndex((segment) => segment.kind === chunk.kind && segment.ordinal === chunk.ordinal);
  if (index < 0) return { messageId: live.messageId, segments: [...live.segments, next] };
  const segments = live.segments.slice();
  const current = segments[index];
  segments[index] = { ...current, text: chunk.ended ? chunk.text : current.text + chunk.text, ended: chunk.ended || current.ended };
  return { messageId: live.messageId, segments };
}

export function liveReplyText(live: LiveReply | undefined): string {
  if (!live) return '';
  return live.segments.filter((segment) => segment.kind === 'text').map((segment) => segment.text).join('\n\n');
}
