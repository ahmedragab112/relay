import type { AgentQuestion } from '../shared/contracts';

export type QuestionSpec = AgentQuestion['questions'][number];

export function questionValues(spec: QuestionSpec, selected: string[], custom: string): string[] {
  const typed = spec.custom ? custom.trim() : '';
  if (spec.kind !== 'choice') return typed ? [typed] : [];
  return [...selected, ...(typed ? [typed] : [])];
}

export function questionStep(index: number, total: number): { position: number; label: string; last: boolean } {
  const count = Math.max(1, total);
  const position = Math.min(Math.max(0, index), count - 1);
  return { position, label: `${position + 1} / ${count}`, last: position === count - 1 };
}

export function missingAnswer(spec: QuestionSpec, answers: string[]): boolean {
  return spec.required && answers.length === 0;
}
