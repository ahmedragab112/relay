export interface TurnTimingMessage {
  role: 'user' | 'assistant' | 'system';
  createdAt: number;
  completedAt?: number;
}

export function turnDurations(messages: TurnTimingMessage[]): number[] {
  const durations: number[] = [];
  let startedAt: number | undefined;
  let completedAt: number | undefined;
  const close = () => {
    if (startedAt !== undefined && completedAt !== undefined) durations.push(Math.max(0, completedAt - startedAt));
  };
  for (const message of messages) {
    if (message.role === 'user') {
      close();
      startedAt = message.createdAt;
      completedAt = undefined;
    } else if (message.role === 'assistant' && message.completedAt !== undefined && startedAt !== undefined) {
      completedAt = Math.max(completedAt ?? 0, message.completedAt);
    }
  }
  close();
  return durations;
}

export function totalWorked(messages: TurnTimingMessage[]): number {
  return turnDurations(messages).reduce((sum, duration) => sum + duration, 0);
}
