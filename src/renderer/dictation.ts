import { notify, report } from './dom';

const maximumBytes = 25 * 1024 * 1024;
const maximumSeconds = 120;

const formats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

interface Active {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  timer: number;
}

export class Dictation {
  private control = document.getElementById('dictate') as HTMLButtonElement;
  private status = document.getElementById('dictation-status') as HTMLElement;
  private active?: Active;
  private busy = false;
  private enabled = false;

  constructor(private input: HTMLTextAreaElement, private configured: () => boolean) {
    this.control.addEventListener('click', () => void this.toggle());
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.render();
  }

  dispose(): void {
    this.cancel();
  }

  cancel(): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    window.clearTimeout(active.timer);
    try { active.recorder.stop(); } catch { active.stream.getTracks().forEach((track) => track.stop()); }
    this.busy = false;
    this.render();
  }

  private async toggle(): Promise<void> {
    if (this.busy) return;
    if (this.active) { this.stop(); return; }
    if (!this.enabled || !this.configured()) {
      notify('Choose a transcription provider in Settings → Voice dictation before recording.', true);
      return;
    }
    await this.start();
  }

  private async start(): Promise<void> {
    this.busy = true; this.render();
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = formats.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const active: Active = { recorder, stream, chunks, timer: 0 };
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('stop', () => void this.finish(active, recorder.mimeType, chunks), { once: true });
      active.timer = window.setTimeout(() => this.stop(), maximumSeconds * 1000);
      this.active = active;
      recorder.start(250);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      const name = error instanceof Error ? error.name : '';
      notify(name === 'NotFoundError'
        ? 'No microphone was found. Connect one and try again.'
        : 'Microphone access was not available. Allow Relay in System Settings → Privacy & Security → Microphone, then try again.', true);
    } finally {
      this.busy = false; this.render();
    }
  }

  private stop(): void {
    const active = this.active;
    if (!active) return;
    window.clearTimeout(active.timer);
    this.busy = true;
    try { active.recorder.stop(); }
    catch { this.release(active); }
    this.render();
  }

  private async finish(active: Active, mimeType: string, chunks: Blob[]): Promise<void> {
    if (this.active !== active) { active.stream.getTracks().forEach((track) => track.stop()); return; }
    window.clearTimeout(active.timer);
    this.active = undefined;
    active.stream.getTracks().forEach((track) => track.stop());
    const mime = mimeType.split(';')[0].trim().toLowerCase();
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) {
      this.busy = false; this.render();
      notify('No audio was captured. Try recording again.', true);
      return;
    }
    if (blob.size > maximumBytes) {
      this.busy = false; this.render();
      notify('The recording is larger than 25 MB. Record a shorter message.', true);
      return;
    }
    try {
      const text = await window.relay.transcribeAudio({ mime, data: await blob.arrayBuffer() });
      this.insert(text);
    } catch (error) {
      report('Dictation failed', error);
    } finally {
      this.busy = false; this.render();
    }
  }

  private release(active: Active): void {
    active.stream.getTracks().forEach((track) => track.stop());
    if (this.active === active) this.active = undefined;
    this.busy = false;
    this.render();
  }

  private insert(value: string): void {
    const text = value.trim();
    if (!text) { notify('The transcription service returned no text.', true); return; }
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    const before = this.input.value.slice(0, start);
    const after = this.input.value.slice(end);
    const lead = before && !/[\s\n]$/.test(before) ? ' ' : '';
    const trail = after && !/^[\s\n]/.test(after) ? ' ' : '';
    const inserted = `${lead}${text}${trail}`;
    this.input.value = `${before}${inserted}${after}`;
    const caret = before.length + inserted.length;
    this.input.setSelectionRange(caret, caret);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.focus();
    notify('Dictation added to your message.');
  }

  private render(): void {
    const recording = Boolean(this.active);
    this.control.classList.toggle('recording', recording);
    this.control.setAttribute('aria-pressed', String(recording));
    this.control.setAttribute('aria-label', recording ? 'Stop recording' : 'Voice dictation');
    this.control.title = recording ? 'Stop recording' : 'Voice dictation';
    this.control.disabled = this.busy || (!recording && !this.enabled);
    this.status.textContent = this.busy ? (recording ? 'Finishing recording…' : 'Transcribing…') : recording ? 'Recording · click to stop' : '';
    this.status.classList.toggle('active', recording || this.busy);
  }
}
