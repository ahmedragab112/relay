import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactFolders, writeJson } from './artifact.js';
import {
  DESIGN_ENTRY, DESIGN_MAX_BYTES, DESIGN_ROOT, DESIGN_SYSTEM_FILE, DESIGN_VERSIONS, designPrompt, designSessionTitle, designSlug,
  designSystemCss, designTitle, implementPrompt, injectPreviewRuntime, isDesignSlug, normalizeDesignSystem,
  type DesignEntry, type DesignSystem, type DesignVersion, type DesignView,
} from '../shared/design.js';
import type { AutoSettings, SendMessageInput } from '../shared/contracts.js';

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
  access(): 'read' | 'ask' | 'auto' | 'full';
  emit(projectId: string, view: DesignView): void;
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
function starterPage(title: string, system: DesignSystem): string {
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

export class Designs {
  /** Engine session behind each design, so a second turn continues the same conversation. */
  private sessions = new Map<string, string>();

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

  async saveSystem(value: unknown): Promise<DesignView> {
    const project = this.requireProject();
    const system = { ...normalizeDesignSystem(value), updatedAt: Date.now() };
    const path = join(project.path, DESIGN_SYSTEM_FILE);
    await mkdir(join(project.path, '.relay'), { recursive: true });
    await writeJson(path, system);
    return this.viewOf(project);
  }

  private async viewOf(project: DesignProject): Promise<DesignView> {
    const designs: DesignEntry[] = [];
    for (const slug of await folders.slugs(project)) {
      const entry = await folders.entry(project, slug);
      if (entry) designs.push(entry);
    }
    designs.sort((a, b) => b.updatedAt - a.updatedAt);
    const view: DesignView = { designs, system: await this.readSystem(project) };
    this.deps.emit(project.id, view);
    return view;
  }

  async view(): Promise<DesignView> {
    return this.viewOf(this.requireProject());
  }

  async create(name: string): Promise<DesignView> {
    const project = this.requireProject();
    const slug = designSlug(name);
    const dir = this.designDir(project, slug);
    const existing = await stat(dir).catch(() => undefined);
    if (existing) throw new Error('A design with that name already exists.');
    const system = await this.readSystem(project);
    const title = designTitle(slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, DESIGN_ENTRY), starterPage(title, system), { mode: 0o600 });
    await folders.snapshot(project, slug, 'Starter page');
    await this.sessionFor(project, slug);
    return this.viewOf(project);
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

  private async modelChoice(project: DesignProject, slug: string): Promise<{ model: string; auto: boolean; autoSettings?: AutoSettings }> {
    const saved = await folders.session(project, slug);
    const chosen = typeof saved?.model === 'string' ? saved.model.trim() : '';
    const fallback = this.deps.model();
    return chosen ? { model: chosen, auto: false } : fallback;
  }

  async send(slug: string, request: string): Promise<{ sessionId: string }> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const text = request.trim();
    if (!text) throw new Error('Describe what the page should be.');
    const existing = await folders.files(project, slug);
    const system = await this.readSystem(project);
    const session = await this.sessionFor(project, slug);
    const choice = await this.modelChoice(project, slug);
    await this.deps.engine().sendMessage({
      sessionId: session.id, text: designPrompt({
        projectName: project.name, slug, request: text, system,
        existing, revision: await this.revision(project, slug),
      }),
      model: choice.model, variant: '', access: 'full', files: [], skills: [],
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

  async cancel(slug: string): Promise<void> {
    const project = this.requireProject();
    const sessionId = this.sessions.get(`${project.path}\u0000${slug}`);
    if (sessionId) await this.deps.engine().abortSession(sessionId).catch(() => undefined);
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

  /** Serves one file to the preview protocol, injecting the token block into HTML. */
  async preview(file: string): Promise<DesignFile | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    let url: URL;
    try { url = new URL(file); } catch { return undefined; }
    if (url.host !== 'preview') return undefined;
    const [rawSlug, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!rawSlug || !isDesignSlug(rawSlug)) return undefined;
    const found = await folders.file(project, rawSlug, rest.length ? rest.join('/') : DESIGN_ENTRY);
    if (!found) return undefined;
    if (found.target.toLowerCase().endsWith('.html')) {
      const html = await readFile(found.target, 'utf8');
      return { body: injectPreviewRuntime(injectDesignSystem(html, await this.readSystem(project))), type: found.type };
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
