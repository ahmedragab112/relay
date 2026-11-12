import type { ToolPart } from '../shared/contracts';

export interface SuggestionContext {
  userText: string;
  replyText: string;
  tools: ToolPart[];
}

const edited = /\b(?:edit|write|patch|create|delete|move|rename)\b/i;
const checked = /\b(?:bash|shell|test|lint|typecheck|build|command)\b/i;
const inspected = /\b(?:read|grep|glob|search|list)\b/i;

export function followUpSuggestions(context: SuggestionContext): string[] {
  const suggestions: string[] = [];
  const add = (value: string) => { if (!suggestions.includes(value)) suggestions.push(value); };
  if (context.tools.some(tool => tool.state === 'error')) {
    add('Investigate the failed step and fix it.');
    add('Show the full error and explain the cause.');
  }
  if (context.tools.some(tool => edited.test(tool.name))) {
    add('Review the changes and flag anything risky.');
    add('Run the tests and fix any failures.');
  }
  if (context.tools.some(tool => checked.test(tool.name))) add('Summarize the results and suggest the next check.');
  if (/\b(?:explain|how|why|compare|trade-?off)\b/i.test(context.userText)) add('Go deeper with a concrete example.');
  if (context.tools.some(tool => inspected.test(tool.name))) add('Summarize what you found and what it means.');
  if (/\?\s*$/.test(context.replyText.trim())) add('Answer the open question and continue.');
  add('Continue with the next step.');
  add('Explain the tradeoffs of this approach.');
  return suggestions.slice(0, 3);
}
