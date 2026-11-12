import type { AgentQuestion, AppEvent, PermissionRequest } from '../shared/contracts';
import { byId } from './dom';
import { permissionCard, questionCard } from './request-cards';

export class RequestView {
  private root = byId('requests');
  private permissions = new Map<string, PermissionRequest>();
  private questions = new Map<string, AgentQuestion>();
  private cards = new Map<string, HTMLElement>();
  private sessionId = '';
  private generation = 0;
  private eventRevision = 0;
  private skipUnanswered = false;
  private skipping = new Set<string>();

  select(id: string): void { this.sessionId = id; this.autoSkip(); this.render(); }
  clear(): void {
    this.generation++;
    this.permissions.clear(); this.questions.clear(); this.cards.clear(); this.root.replaceChildren();
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
  }
}
