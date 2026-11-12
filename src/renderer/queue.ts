import type { QueuedMessage } from '../shared/contracts';
import { byId, button, el, notify, report } from './dom';
import { queuedMeta } from './queue-meta';

export class QueueView {
  private host = byId('queued-messages');
  private sessionId = '';
  private items: QueuedMessage[] = [];
  private busy = new Set<string>();
  private version = 0;

  constructor(private restore: (message: QueuedMessage) => void) {}

  select(sessionId: string): void {
    this.sessionId = sessionId;
    this.busy.clear();
    this.version++;
    if (!sessionId) { this.items = []; this.render(); return; }
    void this.reload();
  }

  async reload(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    const version = ++this.version;
    try {
      const items = await window.relay.listQueuedMessages(sessionId);
      if (version !== this.version || this.sessionId !== sessionId) return;
      this.items = items;
      this.render();
    } catch (error) {
      if (version === this.version) report('Could not load queued messages', error);
    }
  }

  private render(): void {
    this.host.replaceChildren(...this.items.map(message => this.row(message)));
    this.host.hidden = !this.items.length;
  }

  private row(message: QueuedMessage): HTMLElement {
    const article = el('article', `queued-message${message.delivery === 'steer' ? ' steering' : ''}`);
    article.dataset.queueId = message.id;
    const copy = el('div', 'queued-copy');
    copy.append(el('p', 'queued-text', message.text || 'Empty message'), el('p', 'queued-meta', queuedMeta(message)));
    const actions = el('div', 'queued-actions');
    const steering = message.delivery === 'steer';
    const edit = button('Edit', () => this.edit(message), 'text-button');
    edit.setAttribute('aria-label', `Edit queued message: ${message.text.slice(0, 60)}`);
    const sendNow = button(steering ? 'Sending…' : 'Send now', () => this.steer(message), 'text-button');
    sendNow.disabled = steering || this.busy.has(message.id);
    sendNow.title = 'Send this to the running model now instead of waiting for the current reply to finish';
    const remove = button('Remove', () => this.remove(message), 'text-button danger-text');
    remove.setAttribute('aria-label', `Remove queued message: ${message.text.slice(0, 60)}`);
    remove.disabled = this.busy.has(message.id);
    actions.append(edit, sendNow, remove);
    article.append(copy, actions);
    return article;
  }

  private async edit(message: QueuedMessage): Promise<void> {
    if (this.busy.has(message.id)) return;
    const sessionId = this.sessionId;
    this.busy.add(message.id); this.render();
    try {
      await window.relay.removeQueuedMessage(sessionId, message.id);
      if (this.sessionId !== sessionId) return;
      this.items = this.items.filter(item => item.id !== message.id);
      this.busy.delete(message.id);
      this.render();
      this.restore(message);
      notify('Queued message moved back into the composer. Send it again when it is ready.');
    } catch (error) {
      this.busy.delete(message.id); this.render();
      report('Could not edit the queued message', error);
    }
  }

  private async steer(message: QueuedMessage): Promise<void> {
    if (this.busy.has(message.id)) return;
    const sessionId = this.sessionId;
    this.busy.add(message.id);
    this.items = this.items.map(item => item.id === message.id ? { ...item, delivery: 'steer' } : item);
    this.render();
    try {
      await window.relay.steerQueuedMessage(sessionId, message.id);
      if (this.sessionId !== sessionId) return;
      this.busy.delete(message.id);
      this.render();
      notify('Sent to the running model now.');
    } catch (error) {
      this.busy.delete(message.id);
      await this.reload();
      report('Could not send that message to the running model', error);
    }
  }

  private async remove(message: QueuedMessage): Promise<void> {
    if (this.busy.has(message.id)) return;
    const sessionId = this.sessionId;
    this.busy.add(message.id); this.render();
    try {
      await window.relay.removeQueuedMessage(sessionId, message.id);
      if (this.sessionId !== sessionId) return;
      this.items = this.items.filter(item => item.id !== message.id);
      this.busy.delete(message.id);
      this.render();
    } catch (error) {
      this.busy.delete(message.id); this.render();
      report('Could not remove the queued message', error);
    }
  }
}
