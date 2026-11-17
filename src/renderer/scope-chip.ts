import { byId, el } from './dom';
import { t, type Language } from './i18n';
import { wirePlusMenu, type PlusAction } from './plus-menu';
import { SCRATCH_WORKSPACE_ID, type Workspace } from '../shared/contracts';

export interface ScopeView {
  workspace?: Workspace;
  workspaces: Workspace[];
  /** A task that already has messages keeps its folder. */
  locked: boolean;
}

function folderGlyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linejoin', 'round');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', 'M3.5 7.5a2 2 0 0 1 2-2h3.6l1.8 2h7.6a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z');
  svg.append(shape);
  return svg;
}

function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

/** Folder chip in the composer: the folder a new task runs in. */
export class ScopeChip {
  private anchor = byId<HTMLButtonElement>('scope-chip');
  private menu = byId<HTMLElement>('scope-menu');
  private label = el('span', 'scope-label truncate');
  private view: ScopeView = { workspaces: [], locked: false };

  constructor(private pick: (workspaceId: string) => Promise<void>, private choose: () => Promise<void>) {
    this.anchor.append(folderGlyph(), this.label, el('span', 'scope-caret', '▾'));
    wirePlusMenu(this.anchor, this.menu, () => this.actions(), () => Boolean(this.view.workspace) && !this.view.locked);
  }

  sync(view: ScopeView): void {
    this.view = view;
    const workspace = view.workspace;
    this.anchor.hidden = !workspace;
    if (!workspace) return;
    const language = (document.documentElement.lang || 'en') as Language;
    const scratch = workspace.id === SCRATCH_WORKSPACE_ID;
    const name = scratch ? t('scope.no-folder', language) : workspace.name;
    this.label.textContent = name;
    this.anchor.classList.toggle('scratch', scratch);
    this.anchor.classList.toggle('locked', view.locked);
    this.anchor.setAttribute('aria-disabled', String(view.locked));
    this.anchor.title = view.locked
      ? `${name} — this task stays in this folder`
      : `${name} — choose the folder for this task`;
  }

  private actions(): PlusAction[] {
    const language = (document.documentElement.lang || 'en') as Language;
    const current = this.view.workspace?.id ?? '';
    const items: PlusAction[] = [{
      label: t('scope.no-folder', language),
      ...(current === SCRATCH_WORKSPACE_ID ? { hint: '✓' } : {}),
      run: () => this.pick(SCRATCH_WORKSPACE_ID),
    }];
    for (const workspace of this.view.workspaces.filter(item => item.id !== SCRATCH_WORKSPACE_ID).slice(0, 8)) {
      items.push({
        label: workspace.name,
        hint: workspace.id === current ? '✓' : shortPath(workspace.path),
        run: () => this.pick(workspace.id),
      });
    }
    items.push({ label: t('scope.choose-folder', language), run: () => this.choose() });
    return items;
  }
}
