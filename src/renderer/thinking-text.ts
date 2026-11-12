import type { ChatMessage, ToolPart } from '../shared/contracts';

export type ToolState = 'pending' | 'running' | 'completed' | 'error';

export interface ThinkingActivity {
  tool?: { name: string; state: ToolState };
  hasReasoning: boolean;
  hasText: boolean;
}

export function activityOf(messages: ChatMessage[]): ThinkingActivity {
  // Only the replies to the newest message describe what is happening now.
  const turn = messages.slice(messages.map(message => message.role).lastIndexOf('user') + 1)
    .filter(message => message.role === 'assistant' && !message.error);
  if (!turn.length) return { hasReasoning: false, hasText: false };
  const running = turn.flatMap(message => message.parts).reverse().find(
    (part): part is ToolPart => part.type === 'tool' && (part.state === 'running' || part.state === 'pending'));
  const latest = turn[turn.length - 1];
  return {
    ...(running ? { tool: { name: running.name, state: running.state } } : {}),
    hasReasoning: latest.parts.some(part => part.type === 'reasoning' && part.text.trim().length > 0),
    hasText: latest.parts.some(part => part.type === 'text' && part.text.trim().length > 0),
  };
}

export const THINKING_PHRASES = ['Thinking…', 'Deliberating…', 'Pondering…', 'Working through it…', 'Connecting the dots…'];
export const WRITING_PHRASES = ['Writing…', 'Drafting the response…', 'Polishing the answer…'];

const TOOL_LABELS: Record<string, string> = {
  bash: 'Running a command',
  shell: 'Running a command',
  read: 'Reading files',
  list: 'Listing files',
  glob: 'Finding files',
  grep: 'Searching the project',
  edit: 'Applying edits',
  write: 'Writing files',
  patch: 'Applying edits',
  webfetch: 'Reading a web page',
  task: 'Working on a subtask',
  todowrite: 'Updating the plan',
};

export function rotatePhrase(elapsedMs: number, phrases: readonly string[], intervalMs = 3_200): string {
  const index = Math.floor(Math.max(0, elapsedMs) / intervalMs) % phrases.length;
  return phrases[index] ?? phrases[0] ?? '';
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name.toLowerCase()] ?? `Running ${name}`;
}

const STATE_LABELS: Record<ToolState, string> = { pending: 'waiting', running: 'running', completed: 'done', error: 'failed' };

export function toolStateLabel(state: ToolState): string {
  return STATE_LABELS[state];
}

export function thinkingLabel(activity: ThinkingActivity, elapsedMs: number): string {
  const tool = activity.tool;
  if (tool && (tool.state === 'running' || tool.state === 'pending')) return `${toolLabel(tool.name)}…`;
  if (activity.hasText) return rotatePhrase(elapsedMs, WRITING_PHRASES);
  return rotatePhrase(elapsedMs, THINKING_PHRASES);
}

export function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1_000) return '';
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
