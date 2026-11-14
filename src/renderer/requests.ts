import type { AgentQuestion, AppEvent, PermissionRequest } from '../shared/contracts';
import { byId, el } from './dom';
import { requestSignature, shouldHideComposer } from './state';
import { permissionCard, questionCard } from './request-cards';

export class RequestView {
  private root = byId('requests');
  private chat = byId('requests').closest('.chat') as HTMLElement;
  private permissions = new Map<string, PermissionRequest>();
  private questions = new Map<string, AgentQuestion>();
  private cards = new Map<string, HTMLElement>();
  private sessionId = '';
  private generation = 0;
  private eventRevision = 0;
  private skipUnanswered = false;
  private skipping = new Set<string>();
  private signature = '';
  private revealed = false;
  private waiting = 0;
  private note: HTMLElement | undefined;
  private focusStolen = false;

  select(id: string): void { this.sessionId = id; this.autoSkip(); this.render(); }

  // The task list marks any task whose agent is parked on an approval or an answer, so a
  // blocked run is diagnosable from another chat instead of silently looking stalled.
  pendingFor(sessionId: string): number {
    let count = 0;
    for (const request of this.permissions.values()) if (request.sessionId === sessionId) count++;
    for (const request of this.questions.values()) if (request.sessionId === sessionId) count++;
    return count;
  }

  clear(): void {
    this.generation++;
    this.permissions.clear(); this.questions.clear(); this.cards.clear(); this.root.replaceChildren();
    this.signature = ''; this.revealed = false; this.waiting = 0; this.note = undefined; this.focusStolen = false;
    this.apply();
  }

  setSkipUnanswered(value: boolean): void {
    this.skipUnanswered = value;
    this.autoSkip();
    this.render();
  }

  private autoSkip(): void {
    if (!this.skipUnanswered) return;
    for (const request of [...this.questions.values()]) {
      if (request.sessionId !== this.sessionId || this.skipping.has(request.id)) continue;
      this.skipping.add(request.id);
      void window.relay.answerQuestion(request.id, null)
        .then(() => { this.questions.delete(request.id); this.render(); })
        .catch(() => { this.skipping.delete(request.id); });
    }
  }

  async reload(): Promise<void> {
    const generation = this.generation;
    const revision = this.eventRevision;
    const [permissions, questions] = await Promise.all([window.relay.listPermissions(), window.relay.listQuestions()]);
    if (generation !== this.generation || revision !== this.eventRevision) return;
    this.permissions = new Map(permissions.map(request => [request.id, request]));
    this.questions = new Map(questions.map(request => [request.id, request]));
    this.autoSkip();
    this.render();
  }

  event(event: AppEvent): void {
    if (event.type === 'permission') this.permissions.set(event.request.id, event.request);
    else if (event.type === 'permission-resolved') this.permissions.delete(event.id);
    else if (event.type === 'question') { this.questions.set(event.request.id, event.request); this.autoSkip(); }
    else if (event.type === 'question-resolved') this.questions.delete(event.id);
    else return;
    this.eventRevision++;
    this.render();
  }

  private render(): void {
    const visible = new Set<string>();
    const add = (key: string, make: () => HTMLElement) => {
      visible.add(key);
      if (!this.cards.has(key)) this.cards.set(key, make());
      const card = this.cards.get(key)!;
      if (!card.isConnected) this.root.append(card);
    };
    for (const request of this.permissions.values()) if (request.sessionId === this.sessionId) add(`p:${request.id}`, () => permissionCard(request, () => {
      this.permissions.delete(request.id); this.render();
    }));
    for (const request of this.questions.values()) if (request.sessionId === this.sessionId) add(`q:${request.id}`, () => questionCard(request, () => {
      this.questions.delete(request.id); this.render();
    }));
    for (const [id, card] of this.cards) if (!visible.has(id)) { card.remove(); this.cards.delete(id); }
    this.root.hidden = !visible.size;
    const signature = requestSignature([...visible]);
    if (signature !== this.signature) { this.signature = signature; this.revealed = false; }
    this.waiting = visible.size;
    this.apply();
  }

  // While the agent is waiting, the composer hands its space to the request card. The note
  // carries the escape hatch for anyone who still wants to steer the running turn.
  private apply(): void {
    const hide = shouldHideComposer(this.waiting, this.revealed);
    const typing = document.activeElement instanceof HTMLElement && document.activeElement.id === 'prompt';
    if (hide) {
      const note = this.escapeNote();
      this.root.append(note);
      note.hidden = false;
    } else if (this.note) {
      this.note.hidden = true;
    }
    this.chat.classList.toggle('awaiting-input', hide);
    this.root.setAttribute('aria-label', hide ? 'Agent requests — waiting on you' : 'Agent requests');
    if (hide && typing) {
      this.focusStolen = true;
      this.root.querySelector<HTMLElement>('.request-card button, .request-card input')?.focus();
    } else if (!hide && this.focusStolen) {
      this.focusStolen = false;
      byId<HTMLTextAreaElement>('prompt').focus();
    }
  }

  private escapeNote(): HTMLElement {
    if (this.note) return this.note;
    const note = el('div', 'awaiting-note');
    const button = el('button', 'text-button', 'Type anyway');
    button.type = 'button';
    button.addEventListener('click', () => {
      this.revealed = true;
      this.apply();
      byId<HTMLTextAreaElement>('prompt').focus();
    });
    note.append(el('p', '', 'The agent is waiting on you.'), button);
    this.note = note;
    return note;
  }
}
