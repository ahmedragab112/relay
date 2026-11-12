export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function notify(text: string, error = false): void {
  const notice = byId('notice');
  byId('notice-text').textContent = text;
  notice.classList.toggle('error', error);
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.getAnimations().forEach(animation => animation.cancel());
  notice.hidden = false;
}

export function report(context: string, error: unknown): void {
  notify(`${context}: ${errorText(error)}`, true);
}

export function button(text: string, action: () => void | Promise<void>, className = 'button'): HTMLButtonElement {
  const control = el('button', className, text);
  control.type = 'button';
  control.addEventListener('click', () => void run(control, action));
  return control;
}

export async function run(control: HTMLButtonElement | HTMLSelectElement | null, action: () => void | Promise<void>, onError = (error: unknown) => report('Could not complete action. Please try again', error)): Promise<void> {
  if (control?.disabled) return;
  if (control) control.disabled = true;
  try { await action(); } catch (error) { onError(error); }
  finally { if (control) control.disabled = false; }
}

export function field(label: string, input: HTMLElement, help?: string): HTMLLabelElement {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', '', label), input);
  if (help) wrapper.append(el('small', '', help));
  return wrapper;
}

export function option(value: string, label: string): HTMLOptionElement {
  const node = el('option', '', label);
  node.value = value;
  return node;
}
