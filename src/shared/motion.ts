/** Motion: animated scenes built in a project sandbox at .relay/motion, driven by a seekable timeline. */

export const MOTION_ROOT = '.relay/motion';
export const MOTION_ENTRY = 'index.html';
export const MOTION_BRIEF = 'Motion.md';
export const MOTION_VERSIONS = 'versions';
export const MOTION_TITLE_PREFIX = 'Motion · ';
export const MOTION_MAX_BYTES = 8 * 1024 * 1024;
/** Rendered MP4s live here; they are previewable but never sent to the agent. */
export const MOTION_EXPORTS = 'exports';
export const MOTION_EXPORT_FPS = 30;
export const MOTION_MAX_SECONDS = 120;

export type MotionStage = 'portrait' | 'landscape';

export const MOTION_STAGE_SIZE: Record<MotionStage, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export interface MotionEntry {
  slug: string;
  title: string;
  updatedAt: number;
  versions: number;
  /** The visible engine task behind this motion's iterations. */
  sessionId?: string;
  /** Model chosen for this motion's turns; absent means Auto. */
  model?: string;
  /** Stage the piece is authored for; absent means portrait. */
  stage?: MotionStage;
}

export function motionStage(value: unknown): MotionStage {
  return value === 'landscape' ? 'landscape' : 'portrait';
}

export interface MotionVersion {
  version: number;
  savedAt: number;
}

export interface MotionView {
  motions: MotionEntry[];
}

/** "Product Launch — Hero!" → "product-launch-hero". */
export function motionSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!slug) throw new Error('Use letters or numbers in the motion name.');
  return slug;
}

export const isMotionSlug = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);

export function motionTitle(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return 'Motion';
  const [first, ...rest] = words;
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ');
}

export const motionSessionTitle = (slug: string): string => `${MOTION_TITLE_PREFIX}${motionTitle(slug)}`;

export const isMotionSession = (item: { title: string }): boolean => item.title.startsWith(MOTION_TITLE_PREFIX);

/** Whole frames an MP4 needs to cover the scene's duration. */
export function motionFrameCount(duration: number, fps: number = MOTION_EXPORT_FPS): number {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The scene has no duration to export.');
  if (duration > MOTION_MAX_SECONDS) throw new Error(`The scene is too long to export; keep it under ${MOTION_MAX_SECONDS} seconds.`);
  const rate = Math.min(60, Math.max(1, Math.round(fps)));
  return Math.max(1, Math.round(duration * rate));
}

/** "product-launch" + 2026-11-19 14:05:03 → "product-launch-20261119-140503.mp4". */
export function motionExportName(slug: string, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${slug}-${stamp}.mp4`;
}

export interface MotionPromptInput {
  projectName: string;
  slug: string;
  request: string;
  stage: MotionStage;
  existing: string[];
  revision: boolean;
}

export function motionPrompt(input: MotionPromptInput): string {
  const folder = `${MOTION_ROOT}/${input.slug}`;
  const brief = `${folder}/${MOTION_BRIEF}`;
  const size = MOTION_STAGE_SIZE[input.stage];
  const stage = `${size.width}x${size.height} ${input.stage}`;
  const existing = input.existing.length ? input.existing.join(', ') : MOTION_ENTRY;
  const lines = [
    `You are the motion director for ${input.projectName}. Build a motion piece that looks like a studio made it — a real title sequence or product film, not a slideshow with fades.`,
    '',
    `Write only inside ${folder}/. The entry file is ${folder}/${MOTION_ENTRY}. The scene lives in scene.js and its look in motion.css; link everything relatively. The preview runs offline: No CDN links, no web fonts, no network requests. Use system font stacks, inline SVG and CSS gradients.`,
    '',
    '## 1. Decide the direction in Motion.md first',
    input.revision
      ? `Revise the existing motion (${existing}). Read ${brief} and every current file in the folder before editing, then make targeted edits that keep the direction intact.`
      : `Create the motion from scratch. Write ${brief} before you touch any HTML, CSS or JavaScript.`,
    'The brief records: the concept in one sentence; the stage and why; a palette of 4–6 named hex values; a display, body and utility face from system stacks; a shot list table with start and end timecodes, what changes on screen, and the transition into the next shot; the signature moment this piece will be remembered by; one deliberate aesthetic risk; and how the last frame lands (hold, cut to black, seamless loop).',
    'Avoid the defaults AI motion falls into unless the request asks for them: centered wordmark on black with a slow zoom, everything fading in and out, constant floating particles. Spend boldness in one place — the signature moment — and keep everything around it quiet and disciplined.',
    `Design for ${stage}. Keep a safe area (about 8% of the short edge) so nothing clips on any screen; any single paused frame should look composed.`,
    '',
    '## 2. The scene contract — this is how playback and scrubbing work',
    'scene.js must define exactly this shape:',
    'window.motionScene = { duration: 8, update(t) { /* draw the frame at t seconds */ } };',
    '- duration is seconds, between 3 and 30.',
    '- update(t) receives seconds from 0 to duration and is the only thing that draws a frame.',
    '- update(t) must be deterministic: no Date.now, no performance.now, no requestAnimationFrame, no setTimeout inside it, and no Math.random during playback (precompute any randomness once at load).',
    '- Do not use autonomous CSS animations or transitions for scene content: the player sets t, so CSS must not keep moving on its own. Transitions on hover are fine but the piece must read without interaction.',
    '- Motivate every frame: draw from t with transforms, opacity, filters and canvas if you need it. Reset the whole stage from t rather than adding to previous state.',
    '',
    '## 3. Build complete files',
    'index.html sets up the stage; motion.css styles it; scene.js defines window.motionScene. Three complete files are better than one huge file written in pieces.',
    'Write complete files in single writes. Never truncate, never leave TODO or placeholder markup, never leave a broken intermediate draft — each write leaves the folder playable.',
    'Real copy, not lorem ipsum: the actual words this piece shows, even if they only appear for a beat.',
    'Craft floor: crisp typography with deliberate track and leading; motion with weight and intent (anticipation, follow-through, a held beat before the end); no motion that a still frame would contradict; reduced motion is not required to change the piece because the studio controls playback.',
    '',
    'Request:',
    input.request.trim(),
    '',
    `## 4. Check before you reply`,
    `Open the preview and look at the first, middle and last frames at ${stage}. Scrub across each shot boundary and confirm nothing jumps, clips or overlaps; confirm the text is legible at the safe area. Then reply with two or three sentences on what you changed — no code dumps.`,
  ];
  return lines.join('\n');
}

export const MOTION_RUNTIME_ID = 'relay-motion-runtime';

const MOTION_RUNTIME = [
  '<script id="relay-motion-runtime">(function(){',
  'if(window.__relayMotionRuntime)return;window.__relayMotionRuntime=true;',
  'var scene=null,time=0,playing=false,loop=false,raf=0,last=0;',
  'function post(message){try{message.relayMotion=1;parent.postMessage(message,"*")}catch(e){}}',
  'function ensure(){if(!scene&&window.motionScene&&typeof window.motionScene.update==="function")scene=window.motionScene;return scene}',
  'function duration(){var d=ensure()?Number(scene.duration):0;return isFinite(d)&&d>0?d:0}',
  'function draw(){if(!ensure())return;try{scene.update(time)}catch(error){post({type:"error",message:String(error&&error.message||error)})}}',
  'function report(){post({type:"info",duration:duration()});post({type:"time",time:time,playing:playing})}',
  'function tick(now){',
  'if(!playing)return;',
  'if(!last)last=now;',
  'var delta=Math.min(.1,(now-last)/1000);last=now;',
  'var total=duration();time+=delta;',
  'if(total&&time>=total){if(loop){time=time%total}else{time=total;playing=false}}',
  'draw();post({type:"time",time:time,playing:playing});',
  'if(playing)raf=requestAnimationFrame(tick);else post({type:"state",playing:false});',
  '}',
  'function play(){if(playing||!ensure())return;var total=duration();if(total&&time>=total)time=0;playing=true;last=0;raf=requestAnimationFrame(tick);post({type:"state",playing:true})}',
  'function pause(){playing=false;if(raf)cancelAnimationFrame(raf);raf=0;post({type:"state",playing:false})}',
  'function seek(value){var total=duration();var next=Number(value);if(!isFinite(next))return;time=Math.min(total||30,Math.max(0,next));draw();post({type:"time",time:time,playing:playing})}',
  'window.addEventListener("message",function(event){var data=event.data;if(!data)return;',
  'if(typeof data.relayMotionSeek==="number"){seek(data.relayMotionSeek);return}',
  'var command=data.relayMotionCommand;',
  'if(command==="play")play();',
  'else if(command==="pause")pause();',
  'else if(command==="toggle"){playing?pause():play()}',
  'else if(command==="restart"){pause();seek(0);play()}',
  'else if(command==="seek")seek(data.time);',
  'else if(command==="loop"){loop=Boolean(data.loop);post({type:"state",playing:playing,loop:loop})}',
  '});',
  'window.addEventListener("load",function(){draw();report()});',
  'draw();report();',
  '})();</script>',
].join('');

/** Adds the seekable scene player to the entry page on its way out of the preview server. */
export function injectMotionRuntime(html: string): string {
  if (html.includes(MOTION_RUNTIME_ID)) return html;
  const body = html.lastIndexOf('</body>');
  if (body !== -1) return `${html.slice(0, body)}${MOTION_RUNTIME}${html.slice(body)}`;
  return `${html}${MOTION_RUNTIME}`;
}

export type MotionEvent =
  | { type: 'info'; duration: number }
  | { type: 'time'; time: number; playing: boolean }
  | { type: 'state'; playing: boolean }
  | { type: 'error'; message: string };

/** Reads one studio message from a preview; anything malformed is ignored. */
export function motionEvent(value: unknown): MotionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.relayMotion !== 1) return null;
  if (data.type === 'info') {
    if (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < 0) return null;
    return { type: 'info', duration: Math.min(3600, data.duration) };
  }
  if (data.type === 'time') {
    if (typeof data.time !== 'number' || !Number.isFinite(data.time)) return null;
    return { type: 'time', time: Math.min(3600, Math.max(0, data.time)), playing: data.playing === true };
  }
  if (data.type === 'state') return { type: 'state', playing: data.playing === true };
  if (data.type === 'error') return { type: 'error', message: String(data.message ?? 'The scene failed to play.').slice(0, 300) };
  return null;
}

/** Clock label for the scrubber: 0:00.0 */
export function motionClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
