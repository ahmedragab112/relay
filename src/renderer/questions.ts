import type { AgentQuestion } from '../shared/contracts';

export type QuestionSpec = AgentQuestion['questions'][number];

export function questionValues(spec: QuestionSpec, selected: string[], custom: string): string[] {
  const typed = spec.custom ? custom.trim() : '';
  if (spec.kind !== 'choice') return typed ? [typed] : [];
  return [...selected, ...(typed ? [typed] : [])];
}
