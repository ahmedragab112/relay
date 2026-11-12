import type { AgentQuestion, PermissionRequest } from '../shared/contracts';
import { el, errorText } from './dom';
import { questionValues } from './questions';

export function permissionCard(request: PermissionRequest, onResolved: () => void): HTMLElement {
  const card = el('section', 'request-card');
  card.append(el('h3', '', `Permission: ${request.permission}`), el('p', '', request.detail));
  if (request.patterns.length) card.append(el('pre', '', request.patterns.join('\n')));
  const actions = el('div', 'actions');
  const error = el('div', 'inline-error');
  error.setAttribute('role', 'alert');
  for (const [label, decision] of [['Reject', 'reject'], ['Allow once', 'once']] as const) {
    const control = el('button', decision === 'once' ? 'button primary' : 'button', label);
    control.addEventListener('click', () => {
      const controls = actions.querySelectorAll('button');
      controls.forEach(button => { button.disabled = true; });
      error.textContent = '';
      void window.relay.replyPermission(request.id, decision).then(onResolved)
        .catch(value => { error.textContent = `Permission response failed: ${errorText(value)}. Try again.`; })
        .finally(() => controls.forEach(button => { button.disabled = false; }));
    });
    actions.append(control);
  }
  card.append(actions, error);
  return card;
}

export function questionCard(request: AgentQuestion, onResolved: () => void): HTMLElement {
  const card = el('form', 'request-card question-card');
  card.append(el('h3', '', 'The agent has a question'));
  const groups = request.questions.map((question, index) => {
    const group = el('fieldset', 'question-group');
    const legend = el('legend');
    legend.append(el('span', 'question-header', question.header), el('strong', '', `${question.question}${question.required ? ' *' : ''}`));
    group.append(legend);
    const choices: HTMLInputElement[] = [];
    if (question.kind === 'choice') {
      const options = el('div', 'question-options');
      options.setAttribute('role', question.multiple ? 'group' : 'radiogroup');
      for (const [position, option] of question.options.entries()) {
        const label = el('label', 'question-option');
        const input = el('input');
        input.type = question.multiple ? 'checkbox' : 'radio';
        input.name = `${request.id}-${index}`;
        input.value = option.value ?? option.label;
        input.id = `${request.id}-${index}-${position}`;
        const copy = el('span', 'option-copy');
        copy.append(el('strong', '', option.label));
        if (option.description) copy.append(el('small', '', option.description));
        label.append(input, copy, el('span', 'option-mark'));
        options.append(label);
        choices.push(input);
      }
      group.append(options);
    }
    let custom: HTMLInputElement | undefined;
    if (question.custom) {
      const row = el('label', 'question-custom');
      const copy = el('span', 'option-copy');
      copy.append(el('strong', '', question.kind === 'choice' ? 'Type my own' : 'Your answer'), el('small', '', question.placeholder));
      custom = el('input', 'custom-answer');
      custom.type = 'text';
      custom.placeholder = question.placeholder;
      custom.setAttribute('aria-label', `Custom answer for ${question.header}`);
      if (question.kind === 'number') custom.inputMode = 'decimal';
      custom.addEventListener('input', () => {
        if (!question.multiple && custom!.value.trim()) choices.forEach((choice) => { choice.checked = false; });
      });
      row.append(custom, copy);
      group.append(row);
    }
    for (const choice of choices) {
      choice.addEventListener('change', () => {
        if (!question.multiple && custom && custom.value.trim()) custom.value = '';
      });
    }
    card.append(group);
    return { question, choices, custom };
  });
  const actions = el('div', 'actions');
  const reject = el('button', 'button', 'Dismiss'); reject.type = 'button';
  const submit = el('button', 'button primary', 'Send answers'); submit.type = 'submit';
  const error = el('div', 'inline-error'); error.setAttribute('role', 'alert');
  const answer = async (answers: string[][] | null) => {
    const controls = card.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button');
    controls.forEach(control => { control.disabled = true; });
    error.textContent = '';
    try { await window.relay.answerQuestion(request.id, answers); onResolved(); }
    catch (value) { error.textContent = `Answer could not be sent: ${errorText(value)}. Try again.`; }
    finally { controls.forEach(control => { control.disabled = false; }); }
  };
  reject.addEventListener('click', () => void answer(null));
  card.addEventListener('submit', event => {
    event.preventDefault();
    const answers = groups.map(group => questionValues(
      group.question,
      group.choices.filter(choice => choice.checked).map(choice => choice.value),
      group.custom?.value ?? '',
    ));
    const missing = groups.find((group, index) => group.question.required && !answers[index].length);
    if (missing) { error.textContent = `${missing.question.header} is required.`; return; }
    void answer(answers);
  });
  actions.append(reject, submit); card.append(actions, error);
  return card;
}
