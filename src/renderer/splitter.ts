export interface InspectorBounds {
  min: number;
  max: number;
  collapseBelow: number;
}

export const INSPECTOR_BOUNDS: InspectorBounds = { min: 300, max: 720, collapseBelow: 260 };

export type InspectorDrag = { width: number } | { collapsed: true };

export function dragInspector(startWidth: number, dx: number, bounds: InspectorBounds = INSPECTOR_BOUNDS): InspectorDrag {
  const width = startWidth - dx;
  if (width < bounds.collapseBelow) return { collapsed: true };
  return { width: Math.min(bounds.max, Math.max(bounds.min, width)) };
}

const KEYBOARD_STEP = 24;

export class InspectorSplitter {
  private app = document.getElementById('app') as HTMLElement;
  private inspector = document.getElementById('inspector') as HTMLElement;
  private handle = document.getElementById('inspector-resizer') as HTMLElement;
  private button = document.getElementById('inspector-button') as HTMLButtonElement;
  private dragging = false;
  private startX = 0;
  private startWidth = 0;
  private restoreWidth = 0;
  private pointer = -1;

  constructor() {
    this.handle.addEventListener('pointerdown', event => this.down(event));
    this.handle.addEventListener('pointermove', event => this.move(event));
    this.handle.addEventListener('pointerup', () => this.up());
    this.handle.addEventListener('pointercancel', () => this.up());
    this.handle.addEventListener('dblclick', () => this.toggle());
    this.handle.addEventListener('keydown', event => this.key(event));
  }

  get hidden(): boolean { return this.app.classList.contains('inspector-hidden'); }

  hide(): void {
    this.app.classList.add('inspector-hidden');
    this.button.setAttribute('aria-pressed', 'false');
  }

  show(): void {
    this.app.classList.remove('inspector-hidden');
    this.button.setAttribute('aria-pressed', 'true');
  }

  toggle(): void { if (this.hidden) this.show(); else this.hide(); }

  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.hidden) return;
    event.preventDefault();
    this.dragging = true;
    this.pointer = event.pointerId;
    this.startX = event.clientX;
    this.startWidth = this.inspector.getBoundingClientRect().width;
    this.restoreWidth = this.startWidth;
    this.handle.setPointerCapture(event.pointerId);
    this.app.classList.add('splitter-active');
  }

  private move(event: PointerEvent): void {
    if (!this.dragging) return;
    this.apply(dragInspector(this.startWidth, event.clientX - this.startX));
  }

  private up(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.app.classList.remove('splitter-active');
    if (this.pointer >= 0 && this.handle.hasPointerCapture(this.pointer)) this.handle.releasePointerCapture(this.pointer);
    this.pointer = -1;
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const width = this.hidden ? INSPECTOR_BOUNDS.min : this.inspector.getBoundingClientRect().width;
      this.restoreWidth = width;
      if (event.key === 'ArrowRight' && width <= INSPECTOR_BOUNDS.min) { this.hide(); return; }
      this.apply(dragInspector(width, event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle();
    }
  }

  private apply(result: InspectorDrag): void {
    if ('collapsed' in result) {
      if (this.restoreWidth) this.app.style.setProperty('--inspector-width', `${this.restoreWidth}px`);
      this.hide();
      return;
    }
    this.app.style.setProperty('--inspector-width', `${result.width}px`);
    this.show();
  }
}

