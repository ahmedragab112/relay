import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ArtifactFolders, readJson, writeJson } from './artifact.js';
import {
  DESIGN_COMMENTS_FILE, DESIGN_ENTRY, DESIGN_MAX_BYTES, DESIGN_ROOT, DESIGN_SYSTEM_FILE, DESIGN_SYSTEMS_FILE, DESIGN_VERSIONS, cleanDesignPage, designExtras,
  designKind, designPageFile, designPageTitle, designPrompt, designSessionTitle, designSlug, designSystemCss, designTitle, implementPrompt, injectPreviewRuntime,
  isDesignSlug, normalizeDesignSystem, strongestModel,
  type DesignComment, type DesignEntry, type DesignKind, type DesignPage, type DesignSystem, type DesignSystemEntry, type DesignVersion, type DesignView,
} from '../shared/design.js';
import type { AutoSettings, ModelOption, SendMessageInput } from '../shared/contracts.js';
import { DesignWatcher } from './design-watch.js';

export interface DesignProject {
  id: string;
  name: string;
  path: string;
}

export interface DesignEngine {
  createSession(title: string, directory: string): Promise<{ id: string }>;
  sendMessage(input: SendMessageInput): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface DesignDeps {
  project(): DesignProject | undefined;
  engine(): DesignEngine;
  model(): { model: string; auto: boolean; autoSettings?: AutoSettings };
  /** Every model the engine offers, for picking a strong default on Auto. */
  models?(): Promise<ModelOption[]>;
  /** Loopback base the design agent can open in its browser. */
  previewBase?(): Promise<string | undefined>;
  access(): 'read' | 'ask' | 'auto' | 'full';
  emit(projectId: string, view: DesignView): void;
  /** A design file changed on disk; the open preview should refresh. */
  filesChanged?(projectId: string, slug: string, stamp: number): void;
  sessionsChanged(): void;
  /** A design task is a normal, visible task; this clears any legacy hiding. */
  show(sessionId: string): void;
}

export interface DesignFile {
  body: Buffer | string;
  type: string;
}

const folders = new ArtifactFolders({
  root: DESIGN_ROOT,
  entry: DESIGN_ENTRY,
  versions: DESIGN_VERSIONS,
  maxBytes: DESIGN_MAX_BYTES,
  valid: isDesignSlug,
  title: designTitle,
});

function requireSlug(value: string): string {
  if (!isDesignSlug(value)) throw new Error('That design folder is not valid.');
  return value;
}

/** A quiet starter page so the preview shows the design system before the first prompt. */
function pageStarter(title: string, system: DesignSystem): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${designSystemCss(system)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--ds-background);color:var(--ds-text);font-family:var(--ds-font-body);font-size:var(--ds-base)}
main{max-width:34rem;padding:calc(var(--ds-space) * 6);border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface);box-shadow:var(--ds-shadow);text-align:center}
h1{margin:0 0 calc(var(--ds-space) * 1.5);font-family:var(--ds-font-heading);font-size:calc(var(--ds-base) * var(--ds-scale) * var(--ds-scale))}
p{margin:0;color:var(--ds-muted);line-height:1.6}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>Describe the page in the prompt box. The agent writes it here, and this preview reloads when it saves.</p>
</main>
</body>
</html>
`;
}

/** A deck shell: 16:9 scroll-snapped slides with keyboard navigation and a counter. */
function slidesStarter(title: string, system: DesignSystem): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${designSystemCss(system)}
*{box-sizing:border-box}
html{scroll-snap-type:y mandatory;scroll-behavior:smooth}
body{margin:0;background:var(--ds-background);color:var(--ds-text);font-family:var(--ds-font-body);font-size:var(--ds-base)}
.slide{height:100vh;scroll-snap-align:start;display:grid;place-content:center;gap:calc(var(--ds-space) * 2);padding:9vh 10vw}
.eyebrow{margin:0;font-family:var(--ds-font-mono);font-size:calc(var(--ds-base) * 0.75);letter-spacing:.12em;text-transform:uppercase;color:var(--ds-primary)}
.slide h1{margin:0;font-family:var(--ds-font-heading);font-size:calc(var(--ds-base) * var(--ds-scale) * var(--ds-scale) * 1.6);line-height:1.05}
.slide p{margin:0;max-width:56ch;color:var(--ds-muted);font-size:calc(var(--ds-base) * 1.1);line-height:1.6}
.hud{position:fixed;right:1.2rem;bottom:1rem;padding:.45rem .8rem;border:1px solid var(--ds-border);border-radius:999px;background:var(--ds-surface);color:var(--ds-muted);font-family:var(--ds-font-mono);font-size:.75rem;line-height:1}
</style>
</head>
<body>
<main class="deck">
<section class="slide"><p class="eyebrow">${title}</p><h1>Slide one</h1><p>Describe the deck in the prompt box. Each slide is one section — short copy, one idea per slide.</p></section>
<section class="slide"><p class="eyebrow">Slide two</p><h1>The argument continues</h1><p>Arrow keys, space, Home and End move between slides. The counter follows the visible slide.</p></section>
</main>
<div class="hud" id="count">1 / 2</div>
<script>
var slides=[].slice.call(document.querySelectorAll('.slide')),count=document.getElementById('count');
function current(){var best=0,bestD=Infinity;slides.forEach(function(s,i){var d=Math.abs(s.getBoundingClientRect().top);if(d<bestD){bestD=d;best=i}});return best}
function label(){count.textContent=(current()+1)+' / '+slides.length}
function go(i){slides[Math.max(0,Math.min(slides.length-1,i))].scrollIntoView({block:'start',behavior:'smooth'})}
document.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='PageDown'||e.key===' '){e.preventDefault();go(current()+1)}else if(e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();go(current()-1)}else if(e.key==='Home'){e.preventDefault();go(0)}else if(e.key==='End'){e.preventDefault();go(slides.length-1)}});
document.addEventListener('scroll',label,{passive:true});
label();
</script>
</body>
</html>
`;
}

/** A whiteboard shell: a large pannable canvas with zoom controls and sticky notes. */
function boardStarter(title: string, system: DesignSystem): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${designSystemCss(system)}
*{box-sizing:border-box}
body{margin:0;background:var(--ds-background);color:var(--ds-text);font-family:var(--ds-font-body);font-size:var(--ds-base);overflow:auto}
.viewport{min-height:100vh;background-image:radial-gradient(var(--ds-border) 1px, transparent 1px);background-size:24px 24px;padding:40px}
.board{position:relative;width:2400px;height:1600px}
.note{position:absolute;width:240px;padding:calc(var(--ds-space) * 1.5);border-radius:var(--ds-radius);background:var(--ds-surface);border:1px solid var(--ds-border);box-shadow:var(--ds-shadow)}
.note h2{margin:0 0 calc(var(--ds-space) * 0.75);font-family:var(--ds-font-heading);font-size:calc(var(--ds-base) * 1.05)}
.note p{margin:0;color:var(--ds-muted);font-size:calc(var(--ds-base) * 0.9);line-height:1.55}
.zoom{position:fixed;right:1.2rem;bottom:1rem;display:flex;gap:4px;align-items:center;padding:4px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface);box-shadow:var(--ds-shadow)}
.zoom button{width:28px;height:28px;border:0;border-radius:calc(var(--ds-radius) * 0.6);background:transparent;color:var(--ds-text);font:inherit;cursor:pointer}
.zoom button:hover{background:var(--ds-background)}
.zoom span{min-width:44px;text-align:center;font-family:var(--ds-font-mono);font-size:.72rem;color:var(--ds-muted)}
</style>
</head>
<body>
<div class="viewport">
<div class="board" id="board">
<div class="note" style="left:80px;top:80px"><h2>${title}</h2><p>Describe the board in the prompt box. Pan by scrolling; Ctrl+wheel or the controls zoom.</p></div>
<div class="note" style="left:380px;top:220px"><h2>Idea</h2><p>Drop a sticky note here with a short label.</p></div>
<div class="note" style="left:150px;top:520px"><h2>Flow</h2><p>Sketch the screens and connect them with arrows.</p></div>
</div>
</div>
<div class="zoom" role="group" aria-label="Zoom">
<button type="button" data-zoom="-1" aria-label="Zoom out">−</button>
<span id="level">100%</span>
<button type="button" data-zoom="1" aria-label="Zoom in">+</button>
<button type="button" data-zoom="0" aria-label="Reset zoom">Fit</button>
</div>
<script>
var board=document.getElementById('board'),level=document.getElementById('level'),zoom=1;
function apply(){board.style.zoom=zoom;level.textContent=Math.round(zoom*100)+'%'}
document.addEventListener('click',function(e){var b=e.target.closest('[data-zoom]');if(!b)return;var step=Number(b.dataset.zoom);zoom=step===0?1:Math.min(2,Math.max(.25,zoom+step*.1));apply()});
document.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom=Math.min(2,Math.max(.25,zoom+(e.deltaY<0?.1:-.1)));apply()},{passive:false});
apply();
</script>
</body>
</html>
`;
}

function starterPage(kind: DesignKind, title: string, system: DesignSystem): string {
  if (kind === 'slides') return slidesStarter(title, system);
  if (kind === 'board') return boardStarter(title, system);
  return pageStarter(title, system);
}

export class Designs {
  /** Engine session behind each design, so a second turn continues the same conversation. */
  private sessions = new Map<string, string>();
  private watcher?: DesignWatcher;
  private watchRoot?: string;

  constructor(private deps: DesignDeps) {}

  private requireProject(): DesignProject {
    const project = this.deps.project();
    if (!project) throw new Error('Open a project folder first. Designs live inside a project.');
    return project;
  }

  private designDir(project: DesignProject, slug: string): string {
    return folders.dir(project, requireSlug(slug));
  }

  private async readSystem(project: DesignProject): Promise<DesignSystem> {
    try {
      const raw = JSON.parse(await readFile(join(project.path, DESIGN_SYSTEM_FILE), 'utf8')) as unknown;
      return normalizeDesignSystem(raw);
    } catch {
      return normalizeDesignSystem(undefined);
    }
  }

  /** Named systems from the project library, oldest name first. */
  private async readLibrary(project: DesignProject): Promise<DesignSystemEntry[]> {
    const raw = await readJson(join(project.path, DESIGN_SYSTEMS_FILE));
    const list = Array.isArray(raw?.systems) ? raw.systems : [];
    const systems: DesignSystemEntry[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const id = typeof (entry as Record<string, unknown>).id === 'string' ? String((entry as Record<string, unknown>).id) : '';
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || systems.some((system) => system.id === id)) continue;
      systems.push({ ...normalizeDesignSystem(entry), id });
    }
    return systems.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async writeLibrary(project: DesignProject, systems: DesignSystemEntry[]): Promise<void> {
    await mkdir(join(project.path, '.relay'), { recursive: true });
    await writeJson(join(project.path, DESIGN_SYSTEMS_FILE), { version: 1, systems });
  }

  /** The system a design uses: its bound library entry, or the project system. */
  private async systemFor(project: DesignProject, slug: string): Promise<DesignSystem> {
    const saved = await folders.session(project, slug);
    const id = typeof saved?.systemId === 'string' ? saved.systemId : '';
    if (id) {
      const found = (await this.readLibrary(project)).find((system) => system.id === id);
      if (found) return found;
    }
    return this.readSystem(project);
  }

  async saveSystem(value: unknown): Promise<DesignView> {
    const project = this.requireProject();
    const system = { ...normalizeDesignSystem(value), updatedAt: Date.now() };
    const path = join(project.path, DESIGN_SYSTEM_FILE);
    await mkdir(join(project.path, '.relay'), { recursive: true });
    await writeJson(path, system);
    return this.viewOf(project);
  }

  /** Creates or updates a named system in the library, keyed by its name. */
  async saveLibrarySystem(value: unknown): Promise<DesignView> {
    const project = this.requireProject();
    const system = { ...normalizeDesignSystem(value), updatedAt: Date.now() };
    if (!system.name.trim()) throw new Error('Give the design system a name.');
    const id = designSlug(system.name);
    const systems = await this.readLibrary(project);
    const next = systems.some((entry) => entry.id === id)
      ? systems.map((entry) => (entry.id === id ? { ...system, id } : entry))
      : [...systems, { ...system, id }];
    await this.writeLibrary(project, next);
    return this.viewOf(project);
  }

  async deleteLibrarySystem(id: string): Promise<DesignView> {
    const project = this.requireProject();
    const systems = await this.readLibrary(project);
    const next = systems.filter((entry) => entry.id !== id);
    if (next.length === systems.length) throw new Error('That design system no longer exists.');
    await this.writeLibrary(project, next);
    for (const slug of await folders.slugs(project)) {
      const saved = await folders.session(project, slug);
      if (saved?.systemId === id) await folders.saveSession(project, slug, { systemId: '' });
    }
    return this.viewOf(project);
  }

  /** '' binds the design to the project system again. */
  async setDesignSystem(slug: string, id: string): Promise<DesignView> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const wanted = typeof id === 'string' ? id.trim() : '';
    if (wanted && !(await this.readLibrary(project)).some((entry) => entry.id === wanted)) {
      throw new Error('That design system no longer exists.');
    }
    await folders.saveSession(project, clean, { systemId: wanted });
    return this.viewOf(project);
  }

  private async viewOf(project: DesignProject): Promise<DesignView> {
    this.watch(project);
    const designs: DesignEntry[] = [];
    for (const slug of await folders.slugs(project)) {
      const entry = await folders.entry(project, slug);
      if (!entry) continue;
      const saved = await folders.session(project, slug);
      const systemId = typeof saved?.systemId === 'string' && saved.systemId ? saved.systemId : undefined;
      const kind = designKind(saved?.kind);
      designs.push({
        ...entry,
        ...(systemId ? { systemId } : {}),
        ...(kind !== 'page' ? { kind } : {}),
      });
    }
    designs.sort((a, b) => b.updatedAt - a.updatedAt);
    const view: DesignView = {
      designs,
      system: await this.readSystem(project),
      systems: await this.readLibrary(project),
    };
    this.deps.emit(project.id, view);
    return view;
  }

  async view(): Promise<DesignView> {
    return this.viewOf(this.requireProject());
  }

  async create(name: string, requestedKind?: unknown): Promise<DesignView> {
    const project = this.requireProject();
    const slug = designSlug(name);
    const kind = designKind(requestedKind);
    const dir = this.designDir(project, slug);
    const existing = await stat(dir).catch(() => undefined);
    if (existing) throw new Error('A design with that name already exists.');
    const system = await this.readSystem(project);
    const title = designTitle(slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, DESIGN_ENTRY), starterPage(kind, title, system), { mode: 0o600 });
    await folders.snapshot(project, slug, 'Starter page');
    await this.sessionFor(project, slug);
    if (kind !== 'page') await folders.saveSession(project, slug, { kind });
    return this.viewOf(project);
  }

  private async kindFor(project: DesignProject, slug: string): Promise<DesignKind> {
    const saved = await folders.session(project, slug);
    return designKind(saved?.kind);
  }

  async snapshotNow(slug: string): Promise<DesignView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    await folders.snapshot(project, slug, 'Saved by hand');
    return this.viewOf(project);
  }

  async versions(slug: string): Promise<DesignVersion[]> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    return folders.versions(project, slug);
  }

  async restore(slug: string, version: number): Promise<DesignView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    await folders.restore(project, slug, version);
    return this.viewOf(project);
  }

  /** Every screen in the design, entry page first. */
  async pages(slug: string): Promise<DesignPage[]> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const pages: DesignPage[] = [];
    for (const file of await folders.files(project, clean)) {
      if (!/\.html?$/i.test(file)) continue;
      const found = await folders.file(project, clean, file);
      if (!found) continue;
      let head = '';
      try { head = (await readFile(found.target, 'utf8')).slice(0, 8192); } catch { /* label from the file name */ }
      pages.push({ file, name: designPageTitle(file, head) });
    }
    return pages.sort((a, b) => (a.file === DESIGN_ENTRY ? -1 : b.file === DESIGN_ENTRY ? 1 : a.file.localeCompare(b.file)));
  }

  /** Adds an artboard: a themed starter page the agent or the user can fill in. */
  async addPage(slug: string, name: string): Promise<DesignView> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const requested = typeof name === 'string' ? name.replace(/\.html?$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const file = designPageFile(requested);
    if ((await this.pages(clean)).some((page) => page.file === file)) throw new Error('A page with that name already exists.');
    const system = await this.systemFor(project, clean);
    const title = requested || designPageTitle(file, '');
    await writeFile(join(this.designDir(project, clean), file), starterPage('page', title, system), { mode: 0o600 });
    await folders.snapshot(project, clean, 'Artboard added');
    return this.viewOf(project);
  }

  /** Writes a page edited in the preview; the previous state stays as a version. */
  async savePage(slug: string, file: string, html: string): Promise<DesignView> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    if (typeof file !== 'string' || !/\.html?$/i.test(file)) throw new Error('That page is not part of this design.');
    if (!(await this.pages(clean)).some((page) => page.file === file)) throw new Error('That page is not part of this design.');
    const text = cleanDesignPage(typeof html === 'string' ? html : '');
    if (!text) throw new Error('The page is empty.');
    if (Buffer.byteLength(text) > DESIGN_MAX_BYTES) throw new Error('The page is too large to save.');
    await folders.snapshot(project, clean, 'Direct edit');
    await writeFile(join(this.designDir(project, clean), file), text, { mode: 0o600 });
    return this.viewOf(project);
  }

  private commentsPath(project: DesignProject, slug: string): string {
    return join(this.designDir(project, slug), DESIGN_COMMENTS_FILE);
  }

  private async readComments(project: DesignProject, slug: string): Promise<DesignComment[]> {
    const raw = await readJson(this.commentsPath(project, slug));
    const list = Array.isArray(raw?.comments) ? raw.comments : [];
    const comments: DesignComment[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id : '';
      const note = typeof value.note === 'string' ? value.note : '';
      if (!id || !note) continue;
      comments.push({
        id,
        page: typeof value.page === 'string' ? value.page : DESIGN_ENTRY,
        selector: typeof value.selector === 'string' ? value.selector : '',
        note,
        status: value.status === 'sent' ? 'sent' : 'open',
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
      });
    }
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  }

  private async writeComments(project: DesignProject, slug: string, comments: DesignComment[]): Promise<void> {
    await writeJson(this.commentsPath(project, slug), { version: 1, comments });
  }

  async comments(slug: string): Promise<DesignComment[]> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    return this.readComments(project, clean);
  }

  /** A review note on a page; '' accepts notes about the page as a whole. */
  async addComment(slug: string, input: { page: string; selector: string; note: string }): Promise<DesignComment[]> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const page = typeof input?.page === 'string' && input.page ? input.page : DESIGN_ENTRY;
    if (!(await this.pages(clean)).some((entry) => entry.file === page)) throw new Error('That page is not part of this design.');
    const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 2000) : '';
    if (!note) throw new Error('Write a note before adding the comment.');
    const selector = typeof input?.selector === 'string' ? input.selector.trim().slice(0, 500) : '';
    const comments = await this.readComments(project, clean);
    comments.push({ id: randomUUID(), page, selector, note, status: 'open', createdAt: Date.now() });
    await this.writeComments(project, clean, comments);
    return comments;
  }

  async resolveComment(slug: string, id: string): Promise<DesignComment[]> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const comments = await this.readComments(project, clean);
    const next = comments.filter((comment) => comment.id !== id);
    if (next.length === comments.length) throw new Error('That comment no longer exists.');
    await this.writeComments(project, clean, next);
    return next;
  }

  /** Open comments ride one design turn, then stay listed as sent. */
  async sendComments(slug: string): Promise<{ sessionId: string }> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const comments = await this.readComments(project, clean);
    const open = comments.filter((comment) => comment.status === 'open');
    if (!open.length) throw new Error('No open comments to send.');
    const notes = open.map((comment) => `- ${comment.selector ? `${comment.page} · ${comment.selector}` : comment.page}: ${comment.note}`);
    const result = await this.send(clean, [
      'Address these review comments on the design. Change only what they ask for and keep the rest of the page as it is.',
      '',
      ...notes,
    ].join('\n'));
    await this.writeComments(project, clean, comments.map((comment) => comment.status === 'open' ? { ...comment, status: 'sent' } : comment));
    return result;
  }

  private async sessionFor(project: DesignProject, slug: string): Promise<{ id: string }> {
    const key = `${project.path}\u0000${slug}`;
    const known = this.sessions.get(key);
    if (known) return { id: known };
    const saved = await folders.session(project, slug);
    if (typeof saved?.sessionId === 'string' && saved.sessionId) {
      this.sessions.set(key, saved.sessionId);
      this.deps.show(saved.sessionId);
      return { id: saved.sessionId };
    }
    const session = await this.deps.engine().createSession(designSessionTitle(slug), project.path);
    this.sessions.set(key, session.id);
    this.deps.show(session.id);
    await folders.saveSession(project, slug, { sessionId: session.id, title: designTitle(slug) });
    this.deps.sessionsChanged();
    return session;
  }

  private async sessionEntries(project: DesignProject): Promise<Array<{ slug: string; sessionId: string }>> {
    const entries: Array<{ slug: string; sessionId: string }> = [];
    for (const slug of await folders.slugs(project)) {
      const saved = await folders.session(project, slug);
      if (typeof saved?.sessionId === 'string' && saved.sessionId) entries.push({ slug, sessionId: saved.sessionId });
    }
    return entries;
  }

  /** Which design a task belongs to, for routing a sidebar task to its design. */
  async slugForSession(sessionId: string): Promise<string | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    for (const [key, id] of this.sessions) {
      if (id !== sessionId) continue;
      const [path, slug] = key.split('\u0000');
      if (path === project.path && slug && isDesignSlug(slug)) return slug;
    }
    return (await this.sessionEntries(project)).find((entry) => entry.sessionId === sessionId)?.slug;
  }

  /** Deletes a design and its task; nothing outside the design folder is touched. */
  async remove(slug: string): Promise<DesignView> {
    const project = this.requireProject();
    const dir = await folders.require(project, requireSlug(slug));
    const saved = await folders.session(project, slug);
    const sessionId = typeof saved?.sessionId === 'string' && saved.sessionId ? saved.sessionId : undefined;
    if (sessionId) await this.deps.engine().deleteSession(sessionId);
    await rm(dir, { recursive: true, force: true });
    this.sessions.delete(`${project.path}\u0000${slug}`);
    return this.viewOf(project);
  }

  /** '' selects Auto for this design. */
  async setModel(slug: string, model: string): Promise<DesignView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const clean = typeof model === 'string' ? model.trim().slice(0, 512) : '';
    await folders.saveSession(project, slug, { model: clean });
    return this.viewOf(project);
  }

  /** A missing root is retried on the next view, after the first design creates the folder. */
  private watch(project: DesignProject): void {
    if (!this.deps.filesChanged) return;
    const root = folders.root(project);
    if (this.watchRoot !== root) {
      this.watcher?.close();
      this.watchRoot = root;
      this.watcher = new DesignWatcher(root, (slug) => this.deps.filesChanged?.(project.id, slug, Date.now()));
    }
    this.watcher?.start();
  }

  private async modelChoice(project: DesignProject, slug: string): Promise<{ model: string; auto: boolean; autoSettings?: AutoSettings }> {
    const saved = await folders.session(project, slug);
    const chosen = typeof saved?.model === 'string' ? saved.model.trim() : '';
    if (chosen) return { model: chosen, auto: false };
    const fallback = this.deps.model();
    if (!fallback.auto) return fallback;
    const models = await this.deps.models?.().catch(() => [] as ModelOption[]) ?? [];
    const best = strongestModel(models.filter((model) => !model.limited), fallback.autoSettings);
    return best ? { model: best.id, auto: false } : fallback;
  }

  async send(slug: string, request: string, rawExtras?: unknown): Promise<{ sessionId: string }> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const text = request.trim();
    if (!text) throw new Error('Describe what the page should be.');
    const extras = designExtras(rawExtras);
    const existing = await folders.files(project, slug);
    const system = await this.systemFor(project, slug);
    const session = await this.sessionFor(project, slug);
    const choice = await this.modelChoice(project, slug);
    const previewUrl = await this.deps.previewBase?.().catch(() => undefined);
    await this.deps.engine().sendMessage({
      sessionId: session.id, text: designPrompt({
        projectName: project.name, slug, request: text, system,
        existing, revision: await this.revision(project, slug),
        kind: await this.kindFor(project, slug),
        ...(previewUrl ? { previewUrl } : {}),
      }),
      model: choice.model, variant: '', access: 'full',
      files: extras.files, skills: extras.skills,
      ...(extras.agents.length ? { agents: extras.agents } : {}),
      ...(extras.context.length ? { context: extras.context } : {}),
      ...(choice.auto ? { auto: true, autoSettings: choice.autoSettings } : {}),
    });
    await this.bumpTurns(project, slug);
    return { sessionId: session.id };
  }

  /** The first turn creates the direction; later turns revise it. */
  private async revision(project: DesignProject, slug: string): Promise<boolean> {
    const saved = await folders.session(project, slug);
    return typeof saved?.turns === 'number' && saved.turns > 0;
  }

  private async bumpTurns(project: DesignProject, slug: string): Promise<void> {
    const saved = await folders.session(project, slug);
    const turns = typeof saved?.turns === 'number' && saved.turns > 0 ? saved.turns : 0;
    await folders.saveSession(project, slug, { turns: turns + 1 });
  }

  async cancel(slug: string): Promise<boolean> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    const key = `${project.path}\u0000${clean}`;
    let sessionId = this.sessions.get(key);
    if (!sessionId) {
      const saved = await folders.session(project, clean);
      if (typeof saved?.sessionId === 'string' && saved.sessionId) {
        sessionId = saved.sessionId;
        this.sessions.set(key, sessionId);
      }
    }
    if (!sessionId) return false;
    await this.deps.engine().abortSession(sessionId);
    return true;
  }

  /** Called when an engine session goes idle: a finished design turn becomes a version. */
  async noteIdle(sessionId: string): Promise<void> {
    const project = this.deps.project();
    if (!project) return;
    for (const [key, id] of this.sessions) {
      if (id !== sessionId || !key.startsWith(`${project.path}\u0000`)) continue;
      const slug = key.split('\u0000')[1] ?? '';
      if (!isDesignSlug(slug)) return;
      await folders.snapshot(project, slug, 'Agent turn').catch(() => undefined);
      await this.viewOf(project).catch(() => undefined);
      return;
    }
  }

  async implement(slug: string): Promise<{ sessionId: string }> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const title = designTitle(slug);
    const session = await this.deps.engine().createSession(`Implement · ${title}`, project.path);
    const choice = await this.modelChoice(project, slug);
    await this.deps.engine().sendMessage({
      sessionId: session.id, text: implementPrompt({ slug, title }),
      model: choice.model, variant: '', access: this.deps.access(), files: [], skills: [],
      ...(choice.auto ? { auto: true, autoSettings: choice.autoSettings } : {}),
    });
    this.deps.sessionsChanged();
    return { sessionId: session.id };
  }

  /** Path for "Show in Finder"; throws when the design is gone. */
  async reveal(slug: string): Promise<string> {
    const project = this.requireProject();
    return folders.require(project, requireSlug(slug));
  }

  /** Raw page HTML for "Copy page HTML"; the entry page when no file is named. */
  async code(slug: string, file?: string): Promise<{ name: string; text: string }> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    const target = typeof file === 'string' && file ? file : DESIGN_ENTRY;
    if (!/\.html?$/i.test(target)) throw new Error('This design has no page to copy yet.');
    if (!(await this.pages(clean)).some((page) => page.file === target)) throw new Error('This design has no page to copy yet.');
    const found = await folders.file(project, clean, target);
    if (!found) throw new Error('This design has no page to copy yet.');
    return { name: target, text: await readFile(found.target, 'utf8') };
  }

  /** Copies the pages and assets (never versions or session data) to a folder the user chose. */
  async exportFolder(slug: string, target: string): Promise<string> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    const dir = await folders.require(project, clean);
    const versions = join(dir, DESIGN_VERSIONS);
    await cp(dir, target, {
      recursive: true,
      filter: (source) => source !== versions && !source.startsWith(`${versions}/`)
        && basename(source) !== 'session.json' && basename(source) !== DESIGN_COMMENTS_FILE,
    });
    return target;
  }

  /** The loopback URL for a page, for printing it to PDF in a hidden window. */
  async previewURL(slug: string, file?: string): Promise<string | undefined> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    await folders.require(project, clean);
    const base = await this.deps.previewBase?.();
    if (!base) return undefined;
    const page = typeof file === 'string' && file ? file : DESIGN_ENTRY;
    return `${base.replace(/\/$/, '')}/${clean}/${page}`;
  }

  /** Serves one file to the preview protocol, injecting the token block into HTML. */
  async preview(file: string): Promise<DesignFile | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    let url: URL;
    try { url = new URL(file); } catch { return undefined; }
    if (url.host !== 'preview') return undefined;
    const [rawSlug, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!rawSlug || !isDesignSlug(rawSlug)) return undefined;
    return this.serve(project, rawSlug, rest);
  }

  /** Serves one file to the loopback preview server the design agent can open. */
  async servePreview(path: string): Promise<DesignFile | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    const [slug, ...rest] = path.split('/').filter(Boolean);
    if (!slug || !isDesignSlug(slug) || slug === DESIGN_VERSIONS) return undefined;
    if (rest.some((part) => part === DESIGN_VERSIONS || part.startsWith('.'))) return undefined;
    return this.serve(project, slug, rest);
  }

  private async serve(project: DesignProject, slug: string, rest: string[]): Promise<DesignFile | undefined> {
    const found = await folders.file(project, slug, rest.length ? rest.join('/') : DESIGN_ENTRY);
    if (!found) return undefined;
    if (found.target.toLowerCase().endsWith('.html')) {
      const html = await readFile(found.target, 'utf8');
      return { body: injectPreviewRuntime(injectDesignSystem(html, await this.systemFor(project, slug))), type: found.type };
    }
    const body = await readFile(found.target);
    return { body: found.text ? body.toString('utf8') : body, type: found.type };
  }
}

/** Session ids of every design in a project; used to un-hide tasks from older builds. */
export async function designSessionIds(projectPath: string): Promise<string[]> {
  const project = { id: '', name: '', path: projectPath };
  const ids: string[] = [];
  for (const slug of await folders.slugs(project)) {
    const saved = await folders.session(project, slug);
    if (typeof saved?.sessionId === 'string' && saved.sessionId) ids.push(saved.sessionId);
  }
  return ids.sort();
}

/** Adds the project's tokens to any page that does not carry them yet. */
export function injectDesignSystem(html: string, system: DesignSystem): string {
  if (html.includes('--ds-')) return html;
  const style = `<style id="relay-design-system">${designSystemCss(system)}</style>`;
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${style}${html.slice(at)}`;
  }
  if (/^\s*<!doctype/i.test(html)) {
    const body = html.match(/<body[^>]*>/i);
    if (body?.index !== undefined) return `${html.slice(0, body.index)}<head>${style}</head>${html.slice(body.index)}`;
  }
  return `${style}${html}`;
}
