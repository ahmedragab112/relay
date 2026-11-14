import type { FormAnswer, FormField, FormInfo, PermissionRequest as EnginePermission, SessionInfo, SessionMessageInfo } from '@opencode/client';
import type { AgentQuestion, ChatMessage, PermissionRequest, SessionSummary } from '../shared/contracts.js';
import { tokenTotal } from './usage.js';

export function mapSession(session: SessionInfo, running: boolean): SessionSummary {
  return {
    id: session.id, title: session.title || 'Untitled task', updatedAt: session.time.updated,
    status: running ? 'running' : session.outcome === 'failed' ? 'error' : 'idle',
    ...(session.location?.directory ? { directory: session.location.directory } : {}),
    ...(session.fork ? { fork: { sessionId: session.fork.sessionID } } : {}),
  };
}

export function locatedSession(session: SessionInfo, running: boolean, directory: string): SessionSummary {
  const summary = mapSession(session, running);
  return summary.directory ? summary : { ...summary, directory };
}

export function mapMessages(messages: SessionMessageInfo[]): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    if (message.type === 'compaction') {
      return [{ id: message.id, role: 'system', createdAt: message.time.created, parts: [{
        type: 'compaction', id: message.id, status: message.status, reason: message.reason,
        summary: 'summary' in message ? message.summary : '',
        ...(message.status === 'failed' ? { error: message.error.message } : {}),
      }] }];
    }
    if (message.type === 'user') {
      const autoResume = (message.metadata as { relay?: { autoResume?: unknown; model?: unknown } } | undefined)?.relay;
      if (autoResume && (autoResume as { autoResume?: unknown }).autoResume) {
        const model = typeof (autoResume as { model?: unknown }).model === 'string' ? (autoResume as { model: string }).model : undefined;
        return [{ id: message.id, role: 'system', createdAt: message.time.created, parts: [{ id: message.id, type: 'auto-switch' as const, ...(model ? { model } : {}) }] }];
      }
      return [{ id: message.id, role: 'user', createdAt: message.time.created, parts: [
        { id: `${message.id}-text`, type: 'text', text: message.text },
        ...(message.files ?? []).map((file, index) => ({ id: `${message.id}-file-${index}`, type: 'file' as const, name: file.name || file.source.type })),
      ] }];
    }
    if (message.type !== 'assistant') return [];
    return [{ id: message.id, role: 'assistant', createdAt: message.time.created,
      ...(message.time.completed === undefined ? {} : { completedAt: message.time.completed }),
      ...(message.model ? { model: `${message.model.providerID}::${message.model.id}`, ...(message.model.variant ? { modelVariant: message.model.variant } : {}) } : {}),
      ...(message.tokens ? { tokens: tokenTotal(message.tokens) } : {}),
      ...(message.cost ? { cost: message.cost } : {}),
      error: message.error?.message, parts: message.content.map((part, index) => {
      if (part.type !== 'tool') return { id: `${message.id}-${index}`, type: part.type, text: part.text };
      const state = part.state;
      const output = 'content' in state ? (state.content ?? []).map((item) => item.type === 'text' ? item.text : `[File: ${item.name || item.uri}]`).join('\n') : '';
      const background = 'metadata' in state && (state.metadata as Record<string, unknown> | undefined)?.background === true;
      return { type: 'tool', id: part.id, name: part.name, state: state.status === 'streaming' ? 'pending' : state.status,
        ...(background ? { background: true } : {}),
        input: typeof state.input === 'string' ? state.input : JSON.stringify(state.input, null, 2),
        output: state.status === 'error' ? [state.error.message, output].filter(Boolean).join('\n') : output };
    }) }];
  });
}

export function mapPermission(request: EnginePermission): PermissionRequest {
  return { id: request.id, sessionId: request.sessionID, permission: request.action, patterns: request.resources,
    detail: request.message || (request.metadata ? JSON.stringify(request.metadata, null, 2) : request.resources.join('\n')) };
}

const visible = (field: FormField): boolean => !('hidden' in field && field.hidden);

export function mapQuestion(form: FormInfo): AgentQuestion {
  return { id: form.id, sessionId: form.sessionID, questions: form.fields.filter(visible).map((field) => {
    const header = field.title || form.title;
    const question = field.description || field.title || field.key;
    const base = { header, question, multiple: false, custom: true, required: 'required' in field && Boolean(field.required), kind: 'text' as const, placeholder: 'Or type your own answer…', options: [] as AgentQuestion['questions'][number]['options'] };
    if (field.type === 'boolean') return { ...base, custom: false, kind: 'choice' as const, options: [
      { label: 'Yes', description: '', value: 'true' },
      { label: 'No', description: '', value: 'false' },
    ] };
    if (field.type === 'number' || field.type === 'integer') return { ...base, kind: 'number' as const, placeholder: field.type === 'integer' ? 'Whole number' : 'Number' };
    if (field.type === 'external') return base;
    const options = (field.options ?? []).map((option) => ({ label: option.label || option.value, description: option.description || '', value: option.value }));
    const custom = options.length === 0 || field.custom === true;
    return { ...base, multiple: field.type === 'multiselect', custom, kind: options.length ? 'choice' as const : 'text' as const, options };
  }) };
}

export function answerForm(form: FormInfo, answers: string[][]): FormAnswer {
  const fields = form.fields.filter(visible);
  if (answers.length !== fields.length) throw new Error('Answer every question before continuing.');
  const result: FormAnswer = {};
  fields.forEach((field, index) => {
    const values = answers[index];
    if ('required' in field && field.required && (!values.length || !values[0].trim())) throw new Error(`${field.title || field.key} is required.`);
    const options = 'options' in field ? field.options : undefined;
    const mapped = values.map((value) => {
      const option = options?.find((item) => (item.label || item.value) === value || item.value === value);
      if (options?.length && !option && !('custom' in field && field.custom)) throw new Error('Choose a listed option.');
      return option?.value ?? value;
    });
    if (field.type === 'multiselect') result[field.key] = mapped;
    else if (field.type === 'boolean') {
      if (!['true', 'false'].includes(mapped[0])) throw new Error('Enter true or false.');
      result[field.key] = mapped[0] === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      const value = Number(mapped[0]);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw new Error('Enter a valid number.');
      result[field.key] = value;
    } else if (field.type === 'external') throw new Error('External forms are not supported. Cancel this question to continue.');
    else result[field.key] = mapped[0] ?? '';
  });
  return result;
}
