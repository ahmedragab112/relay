import type { ToolPart } from '../shared/contracts';

export interface StepperSummary {
  state: 'completed' | 'running' | 'error';
  label: string;
  detail: string;
}

export function rememberExpansion(open: boolean, fallback: boolean): boolean | undefined {
  return open === fallback ? undefined : open;
}

export function stepperSummary(parts: ToolPart[]): StepperSummary {
  const state = parts.some(part => part.state === 'error') ? 'error'
    : parts.some(part => part.state === 'running' || part.state === 'pending') ? 'running'
    : 'completed';
  const count = parts.length;
  const steps = count === 1 ? 'step' : 'steps';
  const label = state === 'completed' ? `${count} ${steps} completed`
    : state === 'error' ? `${count} ${steps} ${count === 1 ? 'needs' : 'need'} attention`
    : `${count} ${steps} in progress`;
  const names = [...new Set(parts.map(part => part.name))];
  const detail = names.length > 3 ? `${names.slice(0, 3).join(' · ')} +${names.length - 3}` : names.join(' · ');
  return { state, label, detail };
}
