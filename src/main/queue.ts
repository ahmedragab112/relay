import type { AccessLevel, ContextBlock, QueuedMessage } from '../shared/contracts';

const accessLevels: AccessLevel[] = ['read', 'ask', 'auto', 'full'];

function strings(value: unknown, maximum: number): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, maximum) : [];
}

function contextBlocks(value: unknown): ContextBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { label: string; text: string } =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as Record<string, unknown>).label === 'string' && typeof (entry as Record<string, unknown>).text === 'string')
    .slice(0, 6)
    .map((entry) => ({ label: entry.label.slice(0, 160), text: entry.text.slice(0, 20_000) }));
}

export function mapQueuedMessages(items: unknown[]): QueuedMessage[] {
  const queued: QueuedMessage[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (value.type !== 'user') continue;
    const id = typeof value.id === 'string' ? value.id : '';
    if (!id) continue;
    const payload = (value.payload && typeof value.payload === 'object' ? value.payload : {}) as Record<string, unknown>;
    const metadata = payload.metadata && typeof payload.metadata === 'object'
      ? (payload.metadata as Record<string, unknown>).relay
      : undefined;
    const relay = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
    const access = accessLevels.includes(relay.access as AccessLevel) ? relay.access as AccessLevel : 'ask';
    const created = Number((value.time as Record<string, unknown> | undefined)?.created);
    queued.push({
      id,
      text: typeof relay.text === 'string' ? relay.text : typeof payload.text === 'string' ? payload.text : '',
      files: strings(relay.files, 20),
      skills: strings(relay.skills, 10),
      agents: strings(relay.agents, 10),
      model: typeof relay.model === 'string' ? relay.model : '',
      variant: typeof relay.variant === 'string' ? relay.variant : '',
      access,
      planOnly: relay.planOnly === true,
      goalDriven: relay.goalDriven === true,
      context: contextBlocks(relay.context),
      delivery: value.delivery === 'steer' ? 'steer' : 'queue',
      createdAt: Number.isFinite(created) ? created : 0,
    });
  }
  return queued;
}
