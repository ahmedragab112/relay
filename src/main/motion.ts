import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactFolders } from './artifact.js';
import {
  MOTION_ENTRY, MOTION_EXPORTS, MOTION_MAX_BYTES, MOTION_ROOT, MOTION_VERSIONS, injectMotionRuntime, isMotionSlug, motionPrompt,
  motionSessionTitle, motionSlug, motionStage, motionTitle,
  type MotionEntry, type MotionStage, type MotionVersion, type MotionView,
} from '../shared/motion.js';
import type { AutoSettings, SendMessageInput } from '../shared/contracts.js';

export interface MotionProject {
  id: string;
  name: string;
  path: string;
}

export interface MotionEngine {
  createSession(title: string, directory: string): Promise<{ id: string }>;
  sendMessage(input: SendMessageInput): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface MotionDeps {
  project(): MotionProject | undefined;
  engine(): MotionEngine;
  model(): { model: string; auto: boolean; autoSettings?: AutoSettings };
  access(): 'read' | 'ask' | 'auto' | 'full';
  emit(projectId: string, view: MotionView): void;
  sessionsChanged(): void;
  /** A motion task is a normal, visible task; this clears any legacy hiding. */
  show(sessionId: string): void;
}

export interface MotionFile {
  body: Buffer | string;
  type: string;
}

const folders = new ArtifactFolders({
  root: MOTION_ROOT,
  entry: MOTION_ENTRY,
  versions: MOTION_VERSIONS,
  ignored: [MOTION_EXPORTS],
  maxBytes: MOTION_MAX_BYTES,
  valid: isMotionSlug,
  title: motionTitle,
});

function requireSlug(value: string): string {
  if (!isMotionSlug(value)) throw new Error('That motion folder is not valid.');
  return value;
}

/** A calm, deterministic title card so the stage plays before the first prompt. */
function starterScene(title: string, stage: MotionStage): string {
  const [width, height] = stage === 'landscape' ? [1920, 1080] : [1080, 1920];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:#07080a;color:#f2f4f7;font-family:system-ui,sans-serif;overflow:hidden}
.stage{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 10%,#151a22 0%,#07080a 70%)}
.card{text-align:center;padding:6vmin}
.eyebrow{margin:0 0 2.2vmin;font-size:1.8vmin;letter-spacing:.42em;text-transform:uppercase;color:#8d98a7}
h1{margin:0;font-size:9vmin;line-height:.98;letter-spacing:-.03em;font-weight:640}
.line{margin:3.4vmin auto 0;width:26vmin;height:2px;background:#f2f4f7;transform-origin:center}
p{margin:2.6vmin 0 0;font-size:2.2vmin;color:#a7b1bf;line-height:1.6}
</style>
</head>
<body data-stage="${width}x${height}">
<div class="stage" id="stage">
  <div class="card">
    <p class="eyebrow">${stage === 'landscape' ? '16:9' : '9:16'} · ${MOTION_ROOT}</p>
    <h1 id="title">${title}</h1>
    <div class="line" id="line"></div>
    <p id="sub">Describe the motion in the prompt box. The agent writes the scene here and the studio plays it.</p>
  </div>
</div>
<script>
window.motionScene = {
  duration: 6,
  update: function (t) {
    var clamp = function (value) { return Math.min(1, Math.max(0, value)); };
    var enter = clamp((t - 0.15) / 1.2);
    var ease = enter * enter * (3 - 2 * enter);
    var title = document.getElementById('title');
    var line = document.getElementById('line');
    var sub = document.getElementById('sub');
    title.style.opacity = String(ease);
    title.style.transform = 'translateY(' + ((1 - ease) * 2.4).toFixed(2) + 'vmin)';
    line.style.transform = 'scaleX(' + ease.toFixed(3) + ')';
    sub.style.opacity = String(clamp((t - 1.3) / 1.1));
    var out = clamp((t - 5) / 1);
    document.getElementById('stage').style.opacity = String(1 - out * 0.4);
  }
};
</script>
</body>
</html>
`;
}

export class Motions {
  /** Engine session behind each motion, so a second turn continues the same conversation. */
  private sessions = new Map<string, string>();

  constructor(private deps: MotionDeps) {}

  private requireProject(): MotionProject {
    const project = this.deps.project();
    if (!project) throw new Error('Open a project folder first. Motion lives inside a project.');
    return project;
  }

  private async viewOf(project: MotionProject): Promise<MotionView> {
    const motions: MotionEntry[] = [];
    for (const slug of await folders.slugs(project)) {
      const entry = await folders.entry(project, slug);
      if (entry) motions.push({ ...entry, stage: await this.stageOf(project, slug) });
    }
    motions.sort((a, b) => b.updatedAt - a.updatedAt);
    const view: MotionView = { motions };
    this.deps.emit(project.id, view);
    return view;
  }

  async view(): Promise<MotionView> {
    return this.viewOf(this.requireProject());
  }

  async create(name: string): Promise<MotionView> {
    const project = this.requireProject();
    const slug = motionSlug(name);
    const dir = folders.dir(project, slug);
    const existing = await stat(dir).catch(() => undefined);
    if (existing) throw new Error('A motion with that name already exists.');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, MOTION_ENTRY), starterScene(motionTitle(slug), 'portrait'), { mode: 0o600 });
    await folders.snapshot(project, slug, 'Starter scene');
    await this.sessionFor(project, slug);
    return this.viewOf(project);
  }

  async snapshotNow(slug: string): Promise<MotionView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    await folders.snapshot(project, slug, 'Saved by hand');
    return this.viewOf(project);
  }

  async versions(slug: string): Promise<MotionVersion[]> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    return folders.versions(project, slug);
  }

  async restore(slug: string, version: number): Promise<MotionView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    await folders.restore(project, slug, version);
    return this.viewOf(project);
  }

  private async stageOf(project: MotionProject, slug: string): Promise<MotionStage> {
    const saved = await folders.session(project, slug);
    return motionStage(saved?.stage);
  }

  async stage(slug: string): Promise<MotionStage> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    return this.stageOf(project, slug);
  }

  async setStage(slug: string, stage: MotionStage): Promise<MotionView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    await folders.saveSession(project, slug, { stage: motionStage(stage) });
    return this.viewOf(project);
  }

  /** '' selects Auto for this motion. */
  async setModel(slug: string, model: string): Promise<MotionView> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const clean = typeof model === 'string' ? model.trim().slice(0, 512) : '';
    await folders.saveSession(project, slug, { model: clean });
    return this.viewOf(project);
  }

  private async modelChoice(project: MotionProject, slug: string): Promise<{ model: string; auto: boolean; autoSettings?: AutoSettings }> {
    const saved = await folders.session(project, slug);
    const chosen = typeof saved?.model === 'string' ? saved.model.trim() : '';
    const fallback = this.deps.model();
    return chosen ? { model: chosen, auto: false } : fallback;
  }

  private async sessionFor(project: MotionProject, slug: string): Promise<{ id: string }> {
    const key = `${project.path}\u0000${slug}`;
    const known = this.sessions.get(key);
    if (known) return { id: known };
    const saved = await folders.session(project, slug);
    if (typeof saved?.sessionId === 'string' && saved.sessionId) {
      this.sessions.set(key, saved.sessionId);
      this.deps.show(saved.sessionId);
      return { id: saved.sessionId };
    }
    const session = await this.deps.engine().createSession(motionSessionTitle(slug), project.path);
    this.sessions.set(key, session.id);
    this.deps.show(session.id);
    await folders.saveSession(project, slug, { sessionId: session.id, title: motionTitle(slug) });
    this.deps.sessionsChanged();
    return session;
  }

  async send(slug: string, request: string): Promise<{ sessionId: string }> {
    const project = this.requireProject();
    await folders.require(project, requireSlug(slug));
    const text = request.trim();
    if (!text) throw new Error('Describe what the motion should do.');
    const existing = await folders.files(project, slug);
    const session = await this.sessionFor(project, slug);
    const choice = await this.modelChoice(project, slug);
    await this.deps.engine().sendMessage({
      sessionId: session.id, text: motionPrompt({
        projectName: project.name, slug, request: text, stage: await this.stageOf(project, slug),
        existing, revision: await this.revision(project, slug),
      }),
      model: choice.model, variant: '', access: 'full', files: [], skills: [],
      ...(choice.auto ? { auto: true, autoSettings: choice.autoSettings } : {}),
    });
    await this.bumpTurns(project, slug);
    return { sessionId: session.id };
  }

  /** The first turn creates the direction; later turns revise it. */
  private async revision(project: MotionProject, slug: string): Promise<boolean> {
    const saved = await folders.session(project, slug);
    return typeof saved?.turns === 'number' && saved.turns > 0;
  }

  private async bumpTurns(project: MotionProject, slug: string): Promise<void> {
    const saved = await folders.session(project, slug);
    const turns = typeof saved?.turns === 'number' && saved.turns > 0 ? saved.turns : 0;
    await folders.saveSession(project, slug, { turns: turns + 1 });
  }

  async cancel(slug: string): Promise<void> {
    const project = this.requireProject();
    const sessionId = this.sessions.get(`${project.path}\u0000${slug}`);
    if (sessionId) await this.deps.engine().abortSession(sessionId).catch(() => undefined);
  }

  /** Called when an engine session goes idle: a finished motion turn becomes a version. */
  async noteIdle(sessionId: string): Promise<void> {
    const project = this.deps.project();
    if (!project) return;
    for (const [key, id] of this.sessions) {
      if (id !== sessionId || !key.startsWith(`${project.path}\u0000`)) continue;
      const slug = key.split('\u0000')[1] ?? '';
      if (!isMotionSlug(slug)) return;
      await folders.snapshot(project, slug, 'Agent turn').catch(() => undefined);
      await this.viewOf(project).catch(() => undefined);
      return;
    }
  }

  private async sessionEntries(project: MotionProject): Promise<Array<{ slug: string; sessionId: string }>> {
    const entries: Array<{ slug: string; sessionId: string }> = [];
    for (const slug of await folders.slugs(project)) {
      const saved = await folders.session(project, slug);
      if (typeof saved?.sessionId === 'string' && saved.sessionId) entries.push({ slug, sessionId: saved.sessionId });
    }
    return entries;
  }

  /** Which motion a task belongs to, for routing a sidebar task to its motion. */
  async slugForSession(sessionId: string): Promise<string | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    for (const [key, id] of this.sessions) {
      if (id !== sessionId) continue;
      const [path, slug] = key.split('\u0000');
      if (path === project.path && slug && isMotionSlug(slug)) return slug;
    }
    return (await this.sessionEntries(project)).find((entry) => entry.sessionId === sessionId)?.slug;
  }

  /** Deletes a motion and its task; nothing outside the motion folder is touched. */
  async remove(slug: string): Promise<MotionView> {
    const project = this.requireProject();
    const dir = await folders.require(project, requireSlug(slug));
    const saved = await folders.session(project, slug);
    const sessionId = typeof saved?.sessionId === 'string' && saved.sessionId ? saved.sessionId : undefined;
    if (sessionId) await this.deps.engine().deleteSession(sessionId);
    await rm(dir, { recursive: true, force: true });
    this.sessions.delete(`${project.path}\u0000${slug}`);
    return this.viewOf(project);
  }

  /** Path for "Show in Finder"; throws when the motion is gone. */
  async reveal(slug: string): Promise<string> {
    const project = this.requireProject();
    return folders.require(project, requireSlug(slug));
  }

  /** Where the exporter loads the scene from and writes the MP4 to. */
  async exportPlan(slug: string): Promise<{ slug: string; url: string; stage: MotionStage; folder: string }> {
    const project = this.requireProject();
    const clean = requireSlug(slug);
    const dir = await folders.require(project, clean);
    return {
      slug: clean,
      url: `relay-motion://preview/${clean}/${MOTION_ENTRY}`,
      stage: await this.stageOf(project, clean),
      folder: join(dir, MOTION_EXPORTS),
    };
  }

  /** Serves one file to the preview protocol, injecting the seekable player into HTML. */
  async preview(file: string): Promise<MotionFile | undefined> {
    const project = this.deps.project();
    if (!project) return undefined;
    let url: URL;
    try { url = new URL(file); } catch { return undefined; }
    if (url.host !== 'preview') return undefined;
    const [rawSlug, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!rawSlug || !isMotionSlug(rawSlug)) return undefined;
    const found = await folders.file(project, rawSlug, rest.length ? rest.join('/') : MOTION_ENTRY);
    if (!found) return undefined;
    if (found.target.toLowerCase().endsWith('.html')) {
      return { body: injectMotionRuntime(await readFile(found.target, 'utf8')), type: found.type };
    }
    const body = await readFile(found.target);
    return { body: found.text ? body.toString('utf8') : body, type: found.type };
  }
}

/** Session ids of every motion in a project. */
export async function motionSessionIds(projectPath: string): Promise<string[]> {
  const project = { id: '', name: '', path: projectPath };
  const ids: string[] = [];
  for (const slug of await folders.slugs(project)) {
    const saved = await folders.session(project, slug);
    if (typeof saved?.sessionId === 'string' && saved.sessionId) ids.push(saved.sessionId);
  }
  return ids.sort();
}
