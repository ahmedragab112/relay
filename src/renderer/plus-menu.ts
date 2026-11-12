import { button, el } from './dom';

export interface PlusAction {
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export function wirePlusMenu(anchor: HTMLButtonElement, menu: HTMLElement, actions: () => PlusAction[]): void {
  const close = (refocus = false) => {
    menu.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    if (refocus) anchor.focus();
  };
  const open = () => {
    menu.replaceChildren(...actions().map(action => {
      const item = button('', action.run, 'plus-option');
      item.setAttribute('role', 'menuitem');
      item.append(el('span', '', action.label));
      if (action.hint) item.append(el('kbd', '', action.hint));
      item.addEventListener('click', () => close(true));
      return item;
    }));
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  anchor.addEventListener('click', event => {
    event.stopPropagation();
    if (menu.hidden) open(); else close(true);
  });
  anchor.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && menu.hidden) { event.preventDefault(); open(); }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  document.addEventListener('mousedown', event => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !anchor.contains(target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) close(true);
  });
}
