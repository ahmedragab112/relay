import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MOTION_EXPORT_FPS, MOTION_STAGE_SIZE, motionExportName, motionFrameCount, type MotionStage,
} from '../shared/motion.js';

export interface MotionExportInput {
  url: string;
  slug: string;
  stage: MotionStage;
  folder: string;
  preload: string;
  onProgress?(done: number, total: number): void;
}

export interface MotionExportResult {
  file: string;
  frames: number;
  duration: number;
}

const SCENE_TIMEOUT = 20_000;
const FRAME_TIMEOUT = 30_000;
const FINISH_TIMEOUT = 180_000;

/** Steps a hidden stage frame by frame and lets the preload encode it with H.264. */
export async function exportMotion(input: MotionExportInput): Promise<MotionExportResult> {
  const size = MOTION_STAGE_SIZE[input.stage];
  const win = new BrowserWindow({
    show: false, width: size.width, height: size.height, useContentSize: true, frame: false,
    webPreferences: {
      preload: input.preload, contextIsolation: true, sandbox: false, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const next = (channels: string[], timeout: number): Promise<unknown[]> =>
    waitFor(win, channels, timeout);
  try {
    await win.loadURL(input.url);
    const duration = Number(await win.webContents.executeJavaScript(sceneReady(), true));
    const frames = motionFrameCount(duration);
    win.webContents.send('relay-export:start', {
      width: size.width, height: size.height, fps: MOTION_EXPORT_FPS, count: frames,
    });
    await next(['relay-export:ready'], SCENE_TIMEOUT);
    for (let index = 0; index < frames; index += 1) {
      await win.webContents.executeJavaScript(seekScene(index / MOTION_EXPORT_FPS), true);
      const image = await win.webContents.capturePage();
      const bitmap = image.toBitmap();
      if (!bitmap.length || bitmap.length % 4) throw new Error('The stage produced an unreadable frame.');
      win.webContents.send('relay-export:frame', bitmap, Math.round((index * 1_000_000) / MOTION_EXPORT_FPS), index % MOTION_EXPORT_FPS === 0);
      await next(['relay-export:ack'], FRAME_TIMEOUT);
      input.onProgress?.(index + 1, frames);
    }
    win.webContents.send('relay-export:finish');
    const [bytes] = await next(['relay-export:done'], FINISH_TIMEOUT);
    const data = Buffer.from(bytes as ArrayBuffer);
    if (data.length < 1024) throw new Error('The encoder produced an empty video.');
    await mkdir(input.folder, { recursive: true });
    const file = join(input.folder, motionExportName(input.slug, new Date()));
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
    return { file, frames, duration };
  } finally {
    discard(win);
  }
}

/** Resolves with the IPC arguments of the first matching message, or rejects on failure. */
function waitFor(win: BrowserWindow, channels: string[], timeout: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const sender = win.webContents;
    const listeners = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
    const timer = setTimeout(() => finish(new Error('The exporter stopped responding.')), timeout);
    const finish = (error?: Error, value?: unknown[]): void => {
      clearTimeout(timer);
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
      if (error) reject(error);
      else resolve(value ?? []);
    };
    for (const channel of channels) {
      const listener = (event: IpcMainEvent, ...args: unknown[]): void => {
        if (event.sender !== sender) return;
        finish(undefined, args);
      };
      listeners.set(channel, listener);
      ipcMain.on(channel, listener);
    }
    const failed = (_event: IpcMainEvent, message: unknown): void => {
      if (_event.sender !== sender) return;
      finish(new Error(typeof message === 'string' && message ? message : 'The export failed.'));
    };
    ipcMain.on('relay-export:failed', failed);
    listeners.set('relay-export:failed', failed);
  });
}

function sceneReady(): string {
  return `new Promise(function (resolve, reject) {
    var started = Date.now();
    (function check() {
      var scene = window.motionScene;
      if (scene && typeof scene.update === 'function') { resolve(Number(scene.duration) || 0); return; }
      if (Date.now() - started > 15000) { reject(new Error('This scene has no motionScene.update yet.')); return; }
      setTimeout(check, 100);
    })();
  })`;
}

function seekScene(seconds: number): string {
  return `new Promise(function (resolve) {
    window.postMessage({ relayMotionSeek: ${seconds} }, '*');
    requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
  })`;
}

function discard(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy();
}
