import type { ToolPart } from '../shared/contracts';

export interface StepperSummary {
  state: 'completed' | 'running' | 'error';
  label: string;
  detail: string;
  completed: number;
  remaining: number;
}

export function rememberExpansion(open: boolean, fallback: boolean): boolean | undefined {
  return open === fallback ? undefined : open;
}

export function stepperSummary(parts: ToolPart[]): StepperSummary {
  const state = parts.some(part => part.state === 'error') ? 'error'
    : parts.some(part => part.state === 'running' || part.state === 'pending') ? 'running'
    : 'completed';
  const count = parts.length;
  let completed = 0;
  let running = 0;
  let pending = 0;
  for (const part of parts) {
    if (part.state === 'completed') completed += 1;
    else if (part.state === 'running') running += 1;
    else if (part.state === 'pending') pending += 1;
  }
  const remaining = running + pending;
  const steps = count === 1 ? 'step' : 'steps';
  const label = state === 'completed'
    ? `${count} ${steps} completed`
    : state === 'error'
      ? `${completed} of ${count} ${steps} done · ${remaining > 0 ? `${remaining} remaining` : 'attention needed'}`
      : `${completed} of ${count} ${steps} done${remaining > 0 ? ` · ${remaining} remaining` : ''}`;
  const names = [...new Set(parts.map(part => part.name))];
  const detail = names.length > 3 ? `${names.slice(0, 3).join(' · ')} +${names.length - 3}` : names.join(' · ');
  return { state, label, detail, completed, remaining };
}
