import { el } from './dom';
import { dialog } from './dialog';

const steps = [
  {
    title: 'Start with a task',
    body: 'Open a folder and describe the outcome in the composer. The agent works directly inside that project, so its edits land where you can review them.',
  },
  {
    title: 'Watch every step',
    body: 'Replies stream as they are written, with each tool call and file change listed. Review a change and undo it when it is not right, and answer permission requests from Attention.',
  },
  {
    title: 'Make it yours',
    body: 'The command palette finds tasks, files and settings. In Settings you choose the model, how much the agent may do on its own, and a dollar budget that stops a runaway task.',
  },
];

export function showWelcomeTour(onClose: () => void): void {
  const modal = dialog('Welcome to Relay');
  modal.root.classList.add('welcome-tour');
  let index = 0;
  const step = el('div', 'tour-step');
  const dots = el('div', 'tour-dots');
  const actions = el('div', 'dialog-actions');
  const back = el('button', 'button', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => { index -= 1; render(); });
  const skip = el('button', 'text-button tour-skip', 'Skip');
  skip.type = 'button';
  skip.addEventListener('click', () => modal.root.close());
  const next = el('button', 'button primary');
  next.type = 'button';
  next.addEventListener('click', () => {
    if (index === steps.length - 1) { modal.root.close(); return; }
    index += 1;
    render();
  });
  actions.append(back, skip, next);
  modal.add(step, dots, actions);

  function render(): void {
    const current = steps[index]!;
    step.replaceChildren(el('h3', 'tour-title', current.title), el('p', 'tour-copy', current.body));
    dots.replaceChildren(...steps.map((_, position) => el('span', `tour-dot${position === index ? ' active' : ''}`)));
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    next.focus();
  }

  modal.root.addEventListener('close', () => onClose(), { once: true });
  render();
}
