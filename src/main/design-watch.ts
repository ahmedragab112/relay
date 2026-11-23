import { watch, type FSWatcher } from 'node:fs';
import { isDesignSlug } from '../shared/design.js';

/** The design folder a changed file belongs to, or undefined for files that never affect a preview. */
export function designChangeSlug(root: string, filename: string | Buffer | null | undefined): string | undefined {
  if (!filename) return undefined;
  const cleanRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  let relative = filename.toString().replace(/\\/g, '/');
  if (relative === cleanRoot) return undefined;
  if (relative.startsWith(`${cleanRoot}/`)) relative = relative.slice(cleanRoot.length + 1);
  else if (relative.startsWith('/')) return undefined;
  // macOS reports a change to the watched root itself under its own basename.
  if (!relative.includes('/') && relative === cleanRoot.slice(cleanRoot.lastIndexOf('/') + 1)) return undefined;
  const [slug, ...rest] = relative.split('/').filter(Boolean);
  if (!slug || slug === 'versions' || !isDesignSlug(slug)) return undefined;
  if (rest.some((part) => part === 'versions' || part.startsWith('.'))) return undefined;
  const name = rest[rest.length - 1] ?? '';
  if (['comments.json', 'session.json', 'DESIGN.md'].includes(name)) return undefined;
  return slug;
}

/** Watches a design root and reports one change per design after each quiet window. */
export class DesignWatcher {
  private watcher?: FSWatcher;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly root: string,
    private readonly onChange: (slug: string) => void,
    private readonly delay = 350,
  ) {}

  /** Safe to call again after the root appears; a missing root is simply retried later. */
  start(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => this.schedule(designChangeSlug(this.root, filename)));
      this.watcher.on('error', () => this.close());
    } catch {
      this.watcher = undefined;
    }
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule(slug: string | undefined): void {
    if (!slug) return;
    const pending = this.timers.get(slug);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.timers.delete(slug);
      this.onChange(slug);
    }, this.delay);
    timer.unref?.();
    this.timers.set(slug, timer);
  }
}
