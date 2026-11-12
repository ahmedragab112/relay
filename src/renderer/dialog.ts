import { button, el, errorText, field } from './dom';

export function dialog(title: string) {
  const root = el('dialog');
  root.setAttribute('aria-label', title);
  const head = el('header', 'dialog-head');
  const close = button('×', () => root.close(), 'icon-button');
  close.setAttribute('aria-label', 'Close dialog');
  head.append(el('h2', '', title), close);
  const body = el('div', 'dialog-body');
  const error = el('div', 'dialog-error');
  error.setAttribute('role', 'alert');
  root.append(head, body);
  body.append(error);
  document.body.append(root);
  const previous = document.activeElement;
  root.addEventListener('close', () => {
    root.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }, { once: true });
  root.showModal();
  let busy = false;
  root.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  return {
    root, body,
    add(...nodes: Node[]) { error.before(...nodes); },
    fail(value: unknown) { error.textContent = errorText(value); },
    busy(value: boolean) { busy = value; close.disabled = value; },
  };
}

export function confirmAction(title: string, description: string, label = 'Continue'): Promise<boolean> {
  return new Promise(resolve => {
    const modal = dialog(title);
    let accepted = false;
    const actions = el('div', 'dialog-actions');
    actions.append(button('Cancel', () => modal.root.close()), button(label, () => {
      accepted = true;
      modal.root.close();
    }, 'button danger'));
    modal.add(el('p', '', description), actions);
    modal.root.addEventListener('close', () => resolve(accepted), { once: true });
    actions.querySelector('button')?.focus();
  });
}

export function askText(title: string, initial: string, save: (value: string) => Promise<void>): void {
  const modal = dialog(title);
  const input = el('input');
  input.value = initial;
  input.required = true;
  input.maxLength = 200;
  const form = el('form');
  const submit = el('button', 'button primary', 'Save');
  submit.type = 'submit';
  form.append(field('Task name', input), submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim() || submit.disabled) return;
    submit.disabled = true;
    modal.busy(true);
    void save(input.value.trim()).then(() => modal.root.close()).catch(modal.fail).finally(() => {
      submit.disabled = false;
      modal.busy(false);
    });
  });
  modal.add(form);
  input.focus();
  input.select();
}
