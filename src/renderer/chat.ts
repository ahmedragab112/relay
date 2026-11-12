import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage, MessageReaction, ToolPart } from '../shared/contracts';
import { byId, button, el, report } from './dom';
import { externalURL, nearBottom } from './state';
import { ThinkingIndicator } from './thinking';
import { activityOf, toolStateLabel, type ThinkingActivity } from './thinking-text';
import { groupMessages, groupText, lastAssistantIndex, replyBlocks, type MessageGroup } from './message-groups';
import { followUpSuggestions } from './suggestions';
import { rememberExpansion, stepperSummary } from './tool-stepper';
import { appendStream, type LiveReply, type StreamChunk } from './live-reply';
import { formatClock, workSummary } from './turn-time';

export interface ChatActions {
  copy: (value: string) => Promise<void>;
  react: (messageId: string, reaction: MessageReaction | null) => Promise<void>;
  fork: (messageId: string) => Promise<void>;
  addContext: (label: string, text: string) => boolean;
  send: (text: string) => Promise<boolean>;
}

interface IconShape { tag: 'path' | 'line' | 'circle' | 'rect'; attrs: Record<string, string> }

const ICONS: Record<string, IconShape[]> = {
  copy: [
    { tag: 'rect', attrs: { x: '9', y: '9', width: '11', height: '11', rx: '2' } },
    { tag: 'path', attrs: { d: 'M5 15V6a2 2 0 0 1 2-2h8' } },
  ],
  like: [
    { tag: 'path', attrs: { d: 'M7 10.5V20H4.5A1.5 1.5 0 0 1 3 18.5v-6.5A1.5 1.5 0 0 1 4.5 10.5H7Z' } },
    { tag: 'path', attrs: { d: 'M7 10.5 11.2 3.7a1.7 1.7 0 0 1 3.1.9V9h4.5a2 2 0 0 1 2 2.4l-1.3 6.2a2 2 0 0 1-2 1.4H7' } },
  ],
  fork: [
    { tag: 'line', attrs: { x1: '6', y1: '3', x2: '6', y2: '15' } },
    { tag: 'circle', attrs: { cx: '18', cy: '6', r: '3' } },
    { tag: 'circle', attrs: { cx: '6', cy: '18', r: '3' } },
    { tag: 'path', attrs: { d: 'M18 9a9 9 0 0 1-9 9' } },
  ],
  more: [
    { tag: 'circle', attrs: { cx: '5', cy: '12', r: '1.5', fill: 'currentColor', stroke: 'none' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '1.5', fill: 'currentColor', stroke: 'none' } },
    { tag: 'circle', attrs: { cx: '19', cy: '12', r: '1.5', fill: 'currentColor', stroke: 'none' } },
  ],
};

function icon(name: keyof typeof ICONS, flip = false): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (flip) svg.classList.add('flip');
  for (const shape of ICONS[name]) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', shape.tag);
    for (const [key, value] of Object.entries(shape.attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

function markdown(text: string): HTMLElement {
  const node = el('div', 'markdown');
  // Images, forms, styles and active content are deliberately not part of chat.
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  node.append(fragment);
  for (const link of node.querySelectorAll('a')) {
    const safe = externalURL(link.getAttribute('href') ?? '');
    if (safe) { link.href = safe; link.rel = 'noreferrer noopener'; }
    else link.removeAttribute('href');
  }
  return node;
}

export class ChatView {
  private root = byId('conversation');
  private scrollButton = byId<HTMLButtonElement>('scroll-bottom');
  private articles = new Map<string, { root: HTMLElement; signature: string }>();
  private sessionId = '';
  private generation = 0;
  private firstLoad = true;
  private disposed = false;
  private actionMenu?: HTMLElement;
  private menuAnchor?: HTMLElement;
  private menuCleanup?: () => void;
  private thinking = new ThinkingIndicator();
  private running = false;
  private unseen = false;
  private expanded = new Map<string, boolean>();
  private lastMessages: ChatMessage[] = [];
  private live?: LiveReply;
  private liveRoot?: HTMLElement;
  private liveBody?: HTMLElement;
  private liveNodes = new Map<string, Text>();
  private liveTimer?: number;
  private liveSettle = false;
  private liveStarted = 0;
  private liveClock?: HTMLElement;
  private liveTick?: number;
  private linkHandler = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (!target) return;
    event.preventDefault();
    const url = externalURL(target.getAttribute('href') ?? '');
    if (url) void window.relay.openExternal(url).catch(error => report('Could not open link', error));
  };
  private scrollHandler = () => this.updateScrollButton();

  constructor(private actions: ChatActions) {
    this.root.addEventListener('click', this.linkHandler);
    this.root.addEventListener('auxclick', this.linkHandler);
    this.root.addEventListener('scroll', this.scrollHandler, { passive: true });
    this.scrollButton.addEventListener('click', () => this.scrollToBottom());
  }

  select(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    this.closeMenu();
    this.sessionId = sessionId;
    this.generation++;
    this.firstLoad = true;
    this.articles.clear();
    this.lastMessages = [];
    this.running = false;
    this.unseen = false;
    this.expanded.clear();
    this.thinking.reset();
    this.clearLive();
    this.root.replaceChildren(el('p', 'panel-empty', 'Loading conversation…'));
    this.updateScrollButton();
  }

  stream(chunk: StreamChunk): void {
    if (this.disposed) return;
    const previous = this.live;
    this.live = appendStream(previous, chunk);
    if (!previous || previous.messageId !== this.live.messageId) this.liveStarted = Date.now();
    this.liveSettle = false;
    this.thinking.update(this.running, this.currentActivity(this.lastMessages));
    this.scheduleLive();
  }

  private currentActivity(messages: ChatMessage[]): ThinkingActivity {
    const activity = activityOf(messages);
    const segments = this.live?.segments ?? [];
    return {
      ...activity,
      hasText: activity.hasText || segments.some((segment) => segment.kind === 'text' && segment.text.trim().length > 0),
      hasReasoning: activity.hasReasoning || segments.some((segment) => segment.kind === 'reasoning' && segment.text.trim().length > 0),
    };
  }

  /** The authoritative transcript is about to replace the live text. */
  settleStream(): void {
    if (!this.live) return;
    this.liveSettle = true;
    window.setTimeout(() => { if (this.liveSettle) this.clearLive(); }, 2_000);
  }

  setRunning(running: boolean): void {
    const changed = this.running !== running;
    this.running = running;
    this.thinking.update(running, this.currentActivity(this.lastMessages));
    if (changed && this.lastMessages.length) this.update(this.lastMessages);
  }

  empty(title: string, description: string, actions: Array<{ label: string; action: () => void | Promise<void> }> = [], extras: { suggestions?: Array<{ label: string; action: () => void | Promise<void> }>; game?: HTMLElement } = {}): void {
    this.closeMenu();
    this.sessionId = '';
    this.clearLive();
    this.generation++;
    this.articles.clear();
    this.lastMessages = [];
    this.running = false;
    this.unseen = false;
    this.expanded.clear();
    this.thinking.reset();
    const content = el('div', 'empty-state');
    content.append(el('h2', '', title), el('p', '', description));
    const row = el('div', 'row');
    actions.forEach((action, index) => row.append(button(action.label, action.action, index ? 'button' : 'button primary')));
    content.append(row);
    if (extras.suggestions?.length || extras.game) {
      const wrap = el('div', 'home-extras');
      if (extras.suggestions?.length) {
        const suggestions = el('div', 'suggestion-row');
        for (const suggestion of extras.suggestions) suggestions.append(button(suggestion.label, suggestion.action, 'suggestion-chip'));
        wrap.append(suggestions);
      }
      if (extras.game) wrap.append(extras.game);
      content.append(wrap);
    }
    this.root.replaceChildren(content);
    this.updateScrollButton();
  }

  async reload(): Promise<void> {
    const id = this.sessionId;
    const generation = this.generation;
    if (!id || this.disposed) return;
    try {
      const messages = await window.relay.getMessages(id);
      if (this.disposed || generation !== this.generation) return;
      this.update(messages);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      if (this.firstLoad) {
        this.root.replaceChildren(el('p', 'panel-empty', 'Conversation could not be loaded.'), button('Retry', () => this.reload()));
      }
      report('Could not load conversation. Retry or refresh tasks', error);
    }
  }

  private update(messages: ChatMessage[]): void {
    const added = messages.length !== this.lastMessages.length;
    this.lastMessages = messages;
    this.thinking.update(this.running, this.currentActivity(messages));
    const follow = this.firstLoad || nearBottom(this.root);
    if (!follow && added) this.unseen = true;
    if (this.firstLoad || !this.articles.size) this.root.replaceChildren();
    if (this.live && (this.liveSettle || (this.live.segments.every(segment => segment.ended) && messages.some(message => message.id === this.live?.messageId)))) this.clearLive();
    const groups = groupMessages(messages);
    if (!groups.length) this.root.append(el('p', 'panel-empty', 'Start with an outcome. Describe your task below.'));
    const ids = new Set(groups.map(group => group.id));
    for (const [id, article] of this.articles) {
      if (!ids.has(id)) { article.root.remove(); this.articles.delete(id); }
    }
    let userText = '';
    const lastReply = lastAssistantIndex(groups);
    groups.forEach((group, index) => {
      if (group.role === 'user') userText = group.messages.flatMap(message => message.parts).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      const showSuggestions = index === lastReply && !this.running;
      const signature = JSON.stringify({ messages: group.messages, showSuggestions, userText });
      let cached = this.articles.get(group.id);
      if (!cached) {
        cached = { root: el('article', 'message'), signature: '' };
        this.articles.set(group.id, cached);
      }
      if (cached.signature !== signature) {
        const open = new Set(Array.from(cached.root.querySelectorAll<HTMLDetailsElement>('details[open]')).map(detail => detail.dataset.part));
        this.renderGroup(cached.root, group, open, showSuggestions, userText);
        cached.signature = signature;
      }
      if (this.root.children[index] !== cached.root) this.root.insertBefore(cached.root, this.root.children[index] ?? null);
    });
    if (this.live) this.renderLive();
    this.firstLoad = false;
    if (follow) { this.root.scrollTop = this.root.scrollHeight; this.unseen = false; }
    this.updateScrollButton();
  }

  private scheduleLive(): void {
    if (this.liveTimer !== undefined) return;
    this.liveTimer = window.setTimeout(() => { this.liveTimer = undefined; this.renderLive(); }, 80);
  }

  // Live text stays plain so a growing answer never re-parses markdown on every token.
  private renderLive(): void {
    if (this.disposed) return;
    if (!this.live || !this.live.segments.length) { this.clearLive(); return; }
    const follow = nearBottom(this.root);
    if (!this.liveRoot) {
      this.liveRoot = el('article', 'message assistant-message live-message');
      this.liveRoot.setAttribute('aria-label', 'Relay is replying');
      const meta = el('div', 'message-meta');
      this.liveClock = el('span', 'live-clock', formatClock(Date.now() - this.liveStarted));
      meta.append(el('span', 'avatar agent', 'R'), el('span', '', 'Relay'), el('span', 'live-tag', 'Live'), this.liveClock);
      this.liveBody = el('div', 'live-body');
      this.liveRoot.append(meta, this.liveBody);
      this.liveTick = window.setInterval(() => {
        if (this.liveClock) this.liveClock.textContent = formatClock(Date.now() - this.liveStarted);
      }, 1_000);
    }
    if (this.root.lastElementChild !== this.liveRoot) this.root.append(this.liveRoot);
    for (const segment of this.live.segments) {
      const key = `${segment.kind}:${segment.ordinal}`;
      let node = this.liveNodes.get(key);
      if (!node) {
        const wrapper = el('div', segment.kind === 'reasoning' ? 'live-reasoning' : 'markdown live-text');
        node = document.createTextNode('');
        wrapper.append(node);
        this.liveBody!.append(wrapper);
        this.liveNodes.set(key, node);
      }
      if (segment.text !== node.data) {
        if (segment.text.startsWith(node.data)) node.appendData(segment.text.slice(node.data.length));
        else node.data = segment.text;
      }
    }
    if (follow) {
      this.root.scrollTop = this.root.scrollHeight;
      this.unseen = false;
      this.scrollButton.hidden = true;
      this.scrollButton.classList.remove('has-new');
    } else {
      this.unseen = true;
      this.updateScrollButton();
    }
  }

  private clearLive(): void {
    if (this.liveTimer !== undefined) { clearTimeout(this.liveTimer); this.liveTimer = undefined; }
    if (this.liveTick !== undefined) { clearInterval(this.liveTick); this.liveTick = undefined; }
    this.liveClock = undefined;
    this.liveStarted = 0;
    this.live = undefined;
    this.liveSettle = false;
    this.liveNodes.clear();
    this.liveBody = undefined;
    this.liveRoot?.remove();
    this.liveRoot = undefined;
  }

  private renderGroup(root: HTMLElement, group: MessageGroup, open: Set<string | undefined>, showSuggestions: boolean, userText: string): void {
    const role = group.role;
    root.classList.toggle('system-message', role === 'system');
    root.classList.toggle('assistant-message', role === 'assistant');
    root.classList.toggle('user-message', role === 'user');
    if (role === 'system') { this.renderCompaction(root, group.messages[0], open); return; }
    const meta = el('div', 'message-meta');
    meta.append(el('span', `avatar ${role === 'assistant' ? 'agent' : ''}`, role === 'user' ? 'Y' : 'R'), el('span', '', role === 'user' ? 'You' : 'Relay'));
    const date = new Date(group.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const time = el('time', '', date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      time.dateTime = date.toISOString();
      meta.append(time);
    }
    const parts: HTMLElement[] = [];
    if (role === 'user') {
      for (const message of group.messages) {
        for (const part of message.parts) {
          if (part.type === 'text') parts.push(el('div', 'user-text', part.text));
          else if (part.type === 'file') parts.push(el('span', 'attachment', part.name));
        }
      }
    } else {
      const blocks = replyBlocks(group);
      for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (block.kind === 'text') parts.push(markdown(block.text));
        else if (block.kind === 'reasoning') parts.push(this.reasoning(block, open));
        else {
          const tools: ToolPart[] = [block.part];
          while (index + 1 < blocks.length) {
            const next = blocks[index + 1];
            if (next.kind !== 'tool') break;
            tools.push(next.part);
            index++;
          }
          parts.push(this.toolStepper(tools, open));
        }
      }
      for (const message of group.messages) if (message.error) parts.push(el('p', 'inline-error', message.error));
    }
    root.replaceChildren(meta, ...parts);
    if (role === 'assistant') {
      const summary = workSummary(group);
      if (summary) root.append(el('p', 'message-work', summary));
      root.append(this.actionBar(group, parts));
      if (showSuggestions) root.append(this.suggestions(group, open, userText));
    }
  }

  private reasoning(block: { id: string; text: string }, open: Set<string | undefined>): HTMLElement {
    const detail = el('details', 'reasoning');
    detail.dataset.part = block.id;
    detail.open = open.has(block.id);
    const line = block.text.trim().split('\n').map(item => item.trim()).find(Boolean) ?? '';
    const summary = el('summary');
    summary.append(el('span', 'reasoning-glyph', '✦'), el('span', 'reasoning-title', 'Reasoning'),
      el('span', 'reasoning-preview', line.length > 96 ? `${line.slice(0, 96)}…` : line),
      el('span', 'disclosure', '›'));
    detail.append(summary, markdown(block.text));
    return detail;
  }

  private toolStepper(parts: ToolPart[], open: Set<string | undefined>): HTMLElement {
    const summary = stepperSummary(parts);
    const key = `stepper:${parts[0]?.id ?? ''}`;
    const detail = el('details', 'tool-stepper');
    detail.dataset.part = key;
    detail.dataset.state = summary.state;
    const fallback = summary.state !== 'completed';
    detail.open = this.expanded.get(key) ?? fallback;
    const head = el('summary', 'stepper-head');
    head.addEventListener('click', () => this.expanded.set(key, !detail.open));
    detail.addEventListener('toggle', () => {
      if (!detail.isConnected) return;
      const remembered = rememberExpansion(detail.open, fallback);
      if (remembered === undefined) this.expanded.delete(key); else this.expanded.set(key, remembered);
    });
    head.append(
      el('span', 'stepper-glyph', summary.state === 'error' ? '!' : summary.state === 'running' ? '◌' : '✓'),
      el('span', 'stepper-title', summary.label),
      el('span', 'stepper-detail', summary.detail),
      el('span', 'disclosure', '›'),
    );
    const list = el('ol', 'stepper-list');
    for (const part of parts) {
      const item = el('li', 'step');
      item.dataset.state = part.state;
      item.append(el('span', 'step-dot', part.state === 'error' ? '!' : part.state === 'completed' ? '✓' : ''));
      const step = el('details', 'step-detail');
      step.dataset.part = `${part.id}:body`;
      step.open = open.has(step.dataset.part) || part.state === 'error';
      const stepHead = el('summary');
      stepHead.append(
        el('span', 'step-name', part.name),
        el('span', 'step-state', `${toolStateLabel(part.state)}${part.background ? ' · background' : ''}`),
        el('span', 'disclosure', '›'),
      );
      const body = el('div', 'step-body');
      if (part.input) body.append(el('div', 'small muted', 'Input'), el('pre', '', part.input));
      if (part.output) body.append(el('div', 'small muted', 'Output'), el('pre', '', part.output));
      if (!part.input && !part.output) body.append(el('p', 'small muted', part.state === 'running' || part.state === 'pending' ? 'Waiting for output…' : 'No output was returned.'));
      step.append(stepHead, body);
      item.append(step);
      list.append(item);
    }
    detail.append(head, list);
    return detail;
  }

  private suggestions(group: MessageGroup, open: Set<string | undefined>, userText: string): HTMLElement {
    const key = `suggestions:${group.id}`;
    const detail = el('details', 'reply-suggestions');
    detail.dataset.part = key;
    detail.open = open.has(key);
    const summary = el('summary', 'suggestion-toggle');
    summary.append(el('span', 'dotted-rule'), el('span', 'suggestion-label', '✦ Follow-ups'), el('span', 'dotted-rule'), el('span', 'disclosure', '›'));
    const list = el('div', 'suggestion-chips');
    const tools = group.messages.flatMap(message => message.parts).filter((part): part is ToolPart => part.type === 'tool');
    for (const suggestion of followUpSuggestions({ userText, replyText: groupText(group), tools })) {
      const chip = button('', async () => {
        chip.disabled = true;
        try {
          if (!await this.actions.send(suggestion)) chip.disabled = false;
        } catch (error) {
          chip.disabled = false;
          report('Could not send that follow-up', error);
        }
      }, 'suggestion-chip');
      chip.textContent = suggestion;
      chip.title = `Send: ${suggestion}`;
      list.append(chip);
    }
    detail.append(summary, list);
    return detail;
  }

  private actionBar(group: MessageGroup, parts: HTMLElement[]): HTMLElement {
    const bar = el('div', 'message-actions');
    const target = group.messages[group.messages.length - 1];
    const source = groupText(group);
    const plain = () => parts.flatMap(part => part.classList.contains('markdown') ? [part.innerText] : []).join('\n\n').trim();
    const copy = this.actionButton('Copy response', 'copy', async () => { await this.actions.copy(source); }, !source);
    const like = this.actionButton('Like response', 'like', async () => { await this.react(target, 'like', like, dislike); });
    const dislike = this.actionButton('Dislike response', 'like', async () => { await this.react(target, 'dislike', dislike, like); }, false, true);
    const fork = this.actionButton('Branch into a new task', 'fork', async () => { await this.actions.fork(target.id); });
    const more = this.actionButton('More actions', 'more', () => {
      if (this.menuAnchor === more) { this.closeMenu(); return; }
      this.openMenu(more, [
        { label: 'Copy as plain text', run: async () => { await this.actions.copy(plain()); }, disabled: !source },
        { label: 'Add response to task', run: () => { this.actions.addContext(`Response · ${this.labelTime(target)}`, source); }, disabled: !source },
      ]);
    });
    more.classList.add('more-action');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    like.classList.add('like');
    dislike.classList.add('dislike');
    const applyReaction = (value?: MessageReaction) => {
      like.setAttribute('aria-pressed', String(value === 'like'));
      dislike.setAttribute('aria-pressed', String(value === 'dislike'));
    };
    applyReaction(target.reaction);
    bar.append(copy, like, dislike, fork, more);
    return bar;
  }

  private actionButton(label: string, name: keyof typeof ICONS, action: () => void | Promise<void>, disabled = false, flip = false): HTMLButtonElement {
    const control = button('', action, 'message-action');
    control.setAttribute('aria-label', label);
    control.title = label;
    control.disabled = disabled;
    control.append(icon(name, flip));
    return control;
  }

  private labelTime(message: ChatMessage): string {
    const date = new Date(message.createdAt);
    return Number.isNaN(date.getTime()) ? 'Response' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private async react(message: ChatMessage, value: MessageReaction, pressed: HTMLButtonElement, other: HTMLButtonElement): Promise<void> {
    const next = message.reaction === value ? null : value;
    const apply = (state: MessageReaction | null) => {
      pressed.setAttribute('aria-pressed', String(state === value));
      other.setAttribute('aria-pressed', 'false');
      pressed.classList.toggle('active', state === value);
    };
    const previous = message.reaction ?? null;
    apply(next);
    try {
      await this.actions.react(message.id, next);
      message.reaction = next ?? undefined;
    } catch (error) {
      apply(previous);
      report('Could not save that reaction', error);
    }
  }

  private openMenu(anchor: HTMLElement, items: Array<{ label: string; run: () => void | Promise<void>; disabled?: boolean }>): void {
    this.closeMenu();
    const menu = el('div', 'action-menu');
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      const control = button('', item.run, 'action-menu-item', );
      control.setAttribute('role', 'menuitem');
      control.disabled = item.disabled === true;
      control.textContent = item.label;
      control.addEventListener('click', () => this.closeMenu());
      menu.append(control);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.min(window.innerWidth - menu.offsetWidth - 8, Math.max(8, rect.right - menu.offsetWidth)))}px`;
    this.actionMenu = menu;
    this.menuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    anchor.closest('.message')?.classList.add('menu-open');
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || menu.contains(target) || anchor.contains(target)) return;
      this.closeMenu();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeMenu(); anchor.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowDown' ? (index + 1 + buttons.length) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', outside);
    this.menuCleanup = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', outside);
    };
    requestAnimationFrame(() => buttons[0]?.focus());
  }

  private closeMenu(): void {
    if (!this.actionMenu) return;
    this.menuCleanup?.();
    this.menuCleanup = undefined;
    this.actionMenu.remove();
    this.actionMenu = undefined;
    this.menuAnchor?.setAttribute('aria-expanded', 'false');
    this.menuAnchor?.closest('.message')?.classList.remove('menu-open');
    this.menuAnchor = undefined;
  }

  private renderCompaction(root: HTMLElement, message: ChatMessage, open: Set<string | undefined>): void {
    const part = message.parts.find(item => item.type === 'compaction');
    if (!part || part.type !== 'compaction') {
      root.replaceChildren(el('p', 'small muted', 'Conversation updated.'));
      return;
    }
    const card = el('section', `compaction-card ${part.status}`);
    const head = el('div', 'compaction-head');
    head.append(el('span', 'compaction-icon', part.status === 'running' ? '◌' : part.status === 'failed' ? '!' : '≡'));
    head.append(el('span', 'compaction-title', part.status === 'running' ? 'Compacting conversation…' : part.status === 'failed' ? 'Compaction failed' : 'Conversation compacted'));
    head.append(el('span', 'pill', part.reason === 'auto' ? 'Auto' : 'Manual'));
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const time = el('time', '', date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      time.dateTime = date.toISOString();
      head.append(time);
    }
    card.append(head);
    if (part.summary) {
      const details = el('details', 'compaction-summary');
      details.dataset.part = part.id;
      details.open = open.has(part.id);
      details.append(el('summary', '', 'Summary'), markdown(part.summary));
      card.append(details);
    } else if (part.status === 'running') {
      card.append(el('p', 'small muted', 'Earlier turns are being replaced with a summary.'));
    } else if (part.status === 'completed') {
      card.append(el('p', 'small muted', 'Earlier turns were summarized to keep this task within the model context.'));
    }
    if (part.error) card.append(el('p', 'inline-error', part.error));
    root.replaceChildren(card);
  }

  private scrollToBottom(): void {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.root.scrollTo({ top: this.root.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    this.unseen = false;
    this.updateScrollButton();
    this.root.focus({ preventScroll: true });
  }

  private updateScrollButton(): void {
    const atBottom = nearBottom(this.root);
    if (atBottom) this.unseen = false;
    this.scrollButton.hidden = atBottom;
    this.scrollButton.classList.toggle('has-new', this.unseen);
    this.scrollButton.setAttribute('aria-label', this.unseen ? 'Scroll to latest message, new activity' : 'Scroll to latest message');
    this.scrollButton.title = this.unseen ? 'New activity — scroll to latest' : 'Scroll to latest message';
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.closeMenu();
    this.thinking.dispose();
    this.clearLive();
    this.root.removeEventListener('click', this.linkHandler);
    this.root.removeEventListener('auxclick', this.linkHandler);
    this.root.removeEventListener('scroll', this.scrollHandler);
  }
}
