import { byId } from './dom';
import { formatElapsed, thinkingLabel, type ThinkingActivity } from './thinking-text';

export class ThinkingIndicator {
  private root = byId('thinking');
  private label = byId('thinking-label');
  private elapsed = byId('thinking-elapsed');
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;
  private activity: ThinkingActivity = { hasReasoning: false, hasText: false };
  private shown = '';

  constructor(private clock: () => number = () => Date.now()) {}

  update(running: boolean, activity: ThinkingActivity): void {
    this.activity = activity;
    if (!running) { this.stop(); return; }
    if (this.timer === undefined) {
      this.startedAt = this.clock();
      this.root.hidden = false;
      this.root.classList.add('active');
      this.timer = setInterval(() => this.paint(), 1_000);
    }
    this.paint();
  }

  reset(): void {
    this.stop();
    this.shown = '';
  }

  dispose(): void { this.stop(); }

  private paint(): void {
    const elapsed = this.clock() - this.startedAt;
    const text = thinkingLabel(this.activity, elapsed);
    if (text !== this.shown) {
      this.shown = text;
      this.label.textContent = text;
      this.label.classList.remove('swap');
      // Restart the swap animation only when the phrase actually changes.
      void this.label.offsetWidth;
      this.label.classList.add('swap');
    }
    this.elapsed.textContent = formatElapsed(elapsed);
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.root.hidden = true;
    this.root.classList.remove('active');
  }
}
