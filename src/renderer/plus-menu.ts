import { button, el } from './dom';

export interface PlusAction {
  label: string;
  hint?: string;
  icon?: string;
  chevron?: boolean;
  divider?: boolean;
  run: () => void | Promise<void>;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
  attach: 'm20.5 11.5-8.6 8.6a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.2a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  book: 'M5 4h13v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 8h6M8 12h6',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  plan: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6',
  spark: 'M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 17l-1.8-5.5L5 9.7l5.2-1.8z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  robot: 'M12 3v3M6 9h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM9 14h.01M15 14h.01',
  clock: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  slash: 'M15 4 9 20',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M13 15h4',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
};

function mark(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.slash);
  svg.append(path);
  return svg;
}

export function wirePlusMenu(anchor: HTMLButtonElement, menu: HTMLElement, actions: () => PlusAction[], canOpen: () => boolean = () => true): void {
  const close = (refocus = false) => {
    menu.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    if (refocus) anchor.focus();
  };
  const open = () => {
    if (!canOpen()) return;
    menu.replaceChildren(...actions().flatMap(action => {
      const nodes: HTMLElement[] = [];
      if (action.divider) nodes.push(el('span', 'plus-divider'));
      const item = button('', action.run, 'plus-option');
      item.setAttribute('role', 'menuitem');
      if (action.icon) {
        const holder = el('span', 'plus-icon');
        holder.append(mark(action.icon));
        item.append(holder);
      }
      item.append(el('span', 'plus-label', action.label));
      if (action.hint) item.append(el('kbd', '', action.hint));
      if (action.chevron) item.append(el('span', 'plus-chevron', '›'));
      item.addEventListener('click', () => close(true));
      nodes.push(item);
      return nodes;
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
