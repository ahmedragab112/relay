import type { ModelOption } from '../shared/contracts';

export interface ModelGroup {
  label: string;
  models: ModelOption[];
}

export function groupModels(models: ModelOption[], freeOnly: boolean): ModelGroup[] {
  const visible = freeOnly ? models.filter((model) => model.free) : models;
  const groups: ModelGroup[] = [];
  for (const [label, match] of [
    ['Free models', (model: ModelOption) => model.connected && model.free],
    ['Available models', (model: ModelOption) => model.connected && !model.free],
    ['Unavailable', (model: ModelOption) => !model.connected],
  ] as const) {
    const list = visible.filter(match);
    if (list.length) groups.push({ label, models: list });
  }
  return groups;
}

export function resolveVariant(variants: string[] | undefined, preferred: string): string {
  return preferred && variants?.includes(preferred) ? preferred : '';
}

export function variantLabel(variant: string): string {
  return variant ? variant[0].toUpperCase() + variant.slice(1) : '';
}
