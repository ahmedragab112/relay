import type { SearchMode } from '../shared/contracts';
import { el, errorText } from './dom';
import { dialog } from './dialog';

export function showSearch(mode: SearchMode, open: (path: string, line?: number) => void): void {
  const modal = dialog(mode === 'files' ? 'Go to file' : 'Search in files');
  const input = el('input', 'palette-input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.placeholder = mode === 'files' ? 'Search file names…' : 'Search file contents…';
  input.setAttribute('aria-label', input.placeholder);
  const status = el('p', 'small muted');
  const results = el('div', 'palette-results search-results');
  let request = 0;
  let timer: number | undefined;
  const run = async () => {
    const query = input.value.trim();
    const current = ++request;
    if (!query) {
      results.replaceChildren();
      status.textContent = mode === 'files' ? 'Type to jump to a file in this project.' : 'Type to search every text file in this project.';
      return;
    }
    status.textContent = 'Searching…';
    try {
      const found = await window.relay.searchFiles(query, mode);
      if (current !== request) return;
      status.textContent = found.length ? `${found.length}${found.length >= 80 ? '+' : ''} result${found.length === 1 ? '' : 's'}` : 'No matches';
      results.replaceChildren(...found.map(result => {
        const item = el('button', 'palette-option search-result');
        item.type = 'button';
        const copy = el('span', 'search-copy');
        copy.append(el('span', 'search-path', result.path));
        if (result.line) copy.append(el('span', 'search-line', `${result.line}: ${result.preview ?? ''}`));
        item.append(copy);
        if (result.line) item.append(el('span', 'pill', `L${result.line}`));
        item.addEventListener('click', () => { modal.root.close(); open(result.path, result.line); });
        return item;
      }));
    } catch (error) {
      if (current === request) { results.replaceChildren(); status.textContent = `Search failed: ${errorText(error)}`; }
    }
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 160);
  });
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
  modal.add(input, status, results);
  void run();
  input.focus();
}
