import type { QueuedMessage } from '../shared/contracts';

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

export function queuedMeta(message: QueuedMessage): string {
  const parts = [message.delivery === 'steer' ? 'Steering now' : 'Sends when this reply finishes'];
  if (message.files.length) parts.push(count(message.files.length, 'file'));
  if (message.skills.length) parts.push(count(message.skills.length, 'skill'));
  if (message.agents.length) parts.push(count(message.agents.length, 'agent'));
  if (message.context.length) parts.push(count(message.context.length, 'context block'));
  if (message.planOnly) parts.push('Plan only');
  return parts.join(' · ');
}
