// Encoder bridge for the hidden export stage. The main process steps the scene
// and captures frames; this preload turns BGRA bitmaps into an H.264 MP4.

import { ipcRenderer } from 'electron';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

interface ExportConfig {
  width: number;
  height: number;
  fps: number;
  count: number;
}

const CODECS = ['avc1.4D402A', 'avc1.42002A', 'avc1.640028', 'avc1.42E01E'];

let config: ExportConfig | undefined;
let encoder: VideoEncoder | undefined;
let muxer: Muxer<ArrayBufferTarget> | undefined;
let target: ArrayBufferTarget | undefined;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | undefined;
let failed: Error | undefined;

function fail(error: unknown): void {
  failed = error instanceof Error ? error : new Error(String(error));
  ipcRenderer.send('relay-export:failed', failed.message);
}

async function codecSettings(value: ExportConfig): Promise<VideoEncoderConfig> {
  for (const codec of CODECS) {
    const candidate: VideoEncoderConfig = {
      codec, width: value.width, height: value.height, framerate: value.fps,
      bitrate: Math.round(value.width * value.height * value.fps * 0.12), latencyMode: 'quality',
    };
    const support = await VideoEncoder.isConfigSupported(candidate).catch(() => undefined);
    if (support?.supported) return support.config ?? candidate;
  }
  throw new Error('This system has no H.264 encoder, so MP4 export is unavailable.');
}

async function start(value: ExportConfig): Promise<void> {
  config = value;
  target = new ArrayBufferTarget();
  canvas = new OffscreenCanvas(value.width, value.height);
  const drawn = canvas.getContext('2d', { alpha: false });
  if (!drawn) throw new Error('Could not prepare the export canvas.');
  context = drawn;
  muxer = new Muxer({
    target,
    video: { codec: 'avc', width: value.width, height: value.height, frameRate: value.fps },
    fastStart: 'in-memory',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer?.addVideoChunk(chunk, meta, chunk.timestamp),
    error: (error) => fail(error),
  });
  encoder.configure(await codecSettings(value));
  ipcRenderer.send('relay-export:ready');
}

/** capturePage may hand back a Retina-sized BGRA bitmap; normalize it onto the stage canvas. */
async function encodeFrame(bitmap: Uint8Array, timestamp: number, keyFrame: boolean): Promise<void> {
  if (failed) return;
  if (!config || !context || !canvas || !encoder) throw new Error('The exporter was not started.');
  const { width, height, fps } = config;
  const factor = Math.round(Math.sqrt(bitmap.length / 4 / (width * height)));
  if (factor < 1 || factor > 3 || bitmap.length !== width * factor * height * factor * 4) {
    throw new Error(`Unexpected frame size (${bitmap.length} bytes) for a ${width}×${height} stage.`);
  }
  const pixels = new Uint8ClampedArray(bitmap.length);
  for (let index = 0; index < bitmap.length; index += 4) {
    pixels[index] = bitmap[index + 2];
    pixels[index + 1] = bitmap[index + 1];
    pixels[index + 2] = bitmap[index];
    pixels[index + 3] = 255;
  }
  const source = await createImageBitmap(new ImageData(pixels, width * factor, height * factor));
  context.drawImage(source, 0, 0, width, height);
  source.close();
  const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(1_000_000 / fps) });
  encoder.encode(frame, { keyFrame });
  frame.close();
  while (encoder.encodeQueueSize > 4) await new Promise((resolve) => setTimeout(resolve, 4));
}

async function finish(): Promise<void> {
  if (failed) throw failed;
  if (!encoder || !muxer || !target) throw new Error('The exporter was not started.');
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 1024) throw new Error('The encoder produced an empty video.');
  ipcRenderer.send('relay-export:done', buffer);
}

ipcRenderer.on('relay-export:start', (_event, value: ExportConfig) => {
  void start(value).catch(fail);
});

ipcRenderer.on('relay-export:frame', (_event, bitmap: Uint8Array, timestamp: number, keyFrame: boolean) => {
  void encodeFrame(bitmap, timestamp, keyFrame)
    .then(() => ipcRenderer.send('relay-export:ack'))
    .catch(fail);
});

ipcRenderer.on('relay-export:finish', () => {
  void finish().catch(fail);
});
