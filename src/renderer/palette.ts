import { button, el } from './dom';
import { dialog } from './dialog';

export interface Command { label: string; shortcut?: string; action: () => void | Promise<void> }

export function showPalette(commands: Command[]): void {
  const modal = dialog('Search tasks and commands');
  const input = el('input', 'palette-input');
  input.type = 'search'; input.placeholder = 'Search tasks or commands…'; input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search tasks and commands');
  const results = el('div', 'palette-results');
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    const found = commands.filter(command => command.label.toLocaleLowerCase().includes(query));
    results.replaceChildren(...found.map(command => {
      const control = button('', async () => { modal.root.close(); await command.action(); }, 'palette-option');
      control.append(el('span', '', command.label));
      if (command.shortcut) control.append(el('kbd', '', command.shortcut));
      return control;
    }));
    if (!found.length) results.append(el('p', 'muted small', 'No matching tasks or commands.'));
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
  });
  results.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const controls = Array.from(results.querySelectorAll('button'));
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowUp' && index === 0) input.focus();
    else controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
  });
  modal.add(input, results); render(); input.focus();
}
