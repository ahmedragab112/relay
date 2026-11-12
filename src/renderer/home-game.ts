import { el } from './dom';

let best = 0;

export function homeGame(): HTMLElement {
  const root = el('div', 'focus-game');
  const head = el('div', 'focus-game-head');
  const score = el('span', 'focus-result', 'Tap the dot for 20 seconds');
  head.append(el('strong', '', 'Focus game'), score);
  const stage = el('div', 'focus-stage');
  const start = el('button', 'focus-start', 'Start');
  start.type = 'button';
  const dot = el('button', 'focus-dot');
  dot.type = 'button';
  dot.hidden = true;
  dot.setAttribute('aria-label', 'Tap the target');
  stage.append(start, dot);
  root.append(head, stage);

  let clock: number | undefined;
  let mover: number | undefined;
  let taps = 0;
  let remaining = 20;

  const stop = () => {
    window.clearInterval(clock); window.clearInterval(mover);
    clock = undefined; mover = undefined;
    dot.hidden = true; start.hidden = false;
  };
  const place = () => {
    const box = stage.getBoundingClientRect();
    const size = 22;
    dot.style.left = `${size / 2 + 4 + Math.random() * Math.max(1, box.width - size - 8)}px`;
    dot.style.top = `${size / 2 + 4 + Math.random() * Math.max(1, box.height - size - 8)}px`;
  };
  dot.addEventListener('click', () => {
    taps++;
    score.textContent = `${taps} taps · ${remaining}s`;
    place();
  });
  start.addEventListener('click', () => {
    taps = 0; remaining = 20;
    start.hidden = true; dot.hidden = false;
    score.textContent = `0 taps · ${remaining}s`;
    place();
    mover = window.setInterval(place, 950);
    clock = window.setInterval(() => {
      if (!stage.isConnected) { stop(); return; }
      remaining--;
      if (remaining <= 0) {
        stop();
        best = Math.max(best, taps);
        score.textContent = `${taps} taps · best ${best}`;
        return;
      }
      score.textContent = `${taps} taps · ${remaining}s`;
    }, 1000);
  });
  return root;
}
