import type { SessionSummary } from '../shared/contracts';
import { byId, button, el } from './dom';
import { forkRelations } from './fork-graph';

function glyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [
    ['line', { x1: '6', y1: '4', x2: '6', y2: '14' }],
    ['circle', { cx: '18', cy: '6', r: '2.5' }],
    ['circle', { cx: '6', cy: '18', r: '2.5' }],
    ['path', { d: 'M18 8.5a9 9 0 0 1-9 9' }],
  ] as Array<[string, Record<string, string>]>) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

function context(caption: string): HTMLElement {
  const row = el('div', 'branch-context');
  const mark = el('span', 'branch-glyph');
  mark.append(glyph());
  row.append(mark, el('span', 'branch-caption', caption));
  return row;
}

export class BranchBar {
  private root = byId('branch-bar');
  private visible = false;
  private animation?: Animation;

  constructor(private open: (id: string) => void) {}

  render(items: SessionSummary[], sessionId?: string): void {
    const relations = forkRelations(items, sessionId);
    if (!relations.parent && !relations.forks.length) {
      this.hide();
      return;
    }
    const rows: HTMLElement[] = [];
    const parent = relations.parent;
    if (parent) {
      const row = context('Branched from');
      const link = button(parent.title, () => this.open(parent.id), 'branch-link');
      link.title = `Open ${parent.title}`;
      row.append(link);
      rows.push(row);
    }
    if (relations.forks.length) {
      const row = context(relations.forks.length === 1 ? 'Branch' : 'Branches');
      relations.forks.slice(0, 4).forEach((fork) => {
        const link = button(fork.title, () => this.open(fork.id), 'branch-link');
        link.title = `Open ${fork.title}`;
        row.append(link);
      });
      if (relations.forks.length > 4) row.append(el('span', 'branch-count', `+${relations.forks.length - 4}`));
      rows.push(row);
    }
    this.root.replaceChildren(...rows);
    this.show();
  }

  private show(): void {
    const entering = !this.visible;
    this.animation?.cancel();
    this.visible = true;
    this.root.hidden = false;
    if (!entering) return;
    this.root.style.overflow = '';
    this.root.style.height = '';
    const pad = parseFloat(getComputedStyle(this.root).paddingTop) || 0;
    const height = Math.max(0, this.root.getBoundingClientRect().height - pad);
    if (!height) return;
    this.root.style.overflow = 'hidden';
    this.animation = this.root.animate(
      [{ height: '0px', paddingTop: '0px', opacity: 0 }, { height: `${height}px`, paddingTop: `${pad}px`, opacity: 1 }],
      { duration: 190, easing: 'cubic-bezier(.22,.7,.3,1)' },
    );
    this.animation.finished.then(() => {
      this.root.style.overflow = '';
      this.root.style.height = '';
    }).catch(() => {});
  }

  private hide(): void {
    const leaving = this.visible;
    this.visible = false;
    this.animation?.cancel();
    if (!leaving) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    const pad = parseFloat(getComputedStyle(this.root).paddingTop) || 0;
    const height = Math.max(0, this.root.getBoundingClientRect().height - pad);
    if (!height) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    this.root.style.overflow = 'hidden';
    this.animation = this.root.animate(
      [{ height: `${height}px`, paddingTop: `${pad}px`, opacity: 1 }, { height: '0px', paddingTop: '0px', opacity: 0 }],
      { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
    );
    this.animation.finished.then(() => {
      if (this.visible) return;
      this.root.hidden = true;
      this.root.replaceChildren();
      this.root.style.overflow = '';
      this.root.style.height = '';
    }).catch(() => {});
  }
}
