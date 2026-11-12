import type { AppState, GeneralSettings, PreferencesPatch, ProviderInput, SessionSummary, Theme } from '../shared/contracts';
import { CONFIGURABLE_PROVIDERS, providerName, providerPreset, type ConfigurableProviderID } from '../shared/providers';
import { button, el, errorText, field, option } from './dom';
import { confirmAction, dialog } from './dialog';

const groupLabel: Record<string, string> = { free: 'Free', local: 'Local', paid: 'Paid', custom: 'Custom' };
type Category = 'general' | 'appearance' | 'context' | 'voice' | 'providers' | 'archive' | 'about';

const navigation: Array<{ group: string; items: Array<{ id: Category; label: string }> }> = [
  { group: 'Relay', items: [{ id: 'general', label: 'General' }, { id: 'appearance', label: 'Appearance' }, { id: 'context', label: 'Context & usage' }] },
  { group: 'Connect', items: [{ id: 'voice', label: 'Voice dictation' }, { id: 'providers', label: 'Model providers' }] },
  { group: 'Data', items: [{ id: 'archive', label: 'Archived tasks' }, { id: 'about', label: 'About Relay' }] },
];

export function showSettings(getState: () => AppState, apply: (state: AppState) => void, refreshModels: () => Promise<void>): void {
  const modal = dialog('Settings');
  modal.root.classList.add('settings-dialog');
  const shell = el('div', 'settings-shell');
  const nav = el('nav', 'settings-nav');
  nav.setAttribute('aria-label', 'Settings sections');
  const pane = el('div', 'settings-pane');
  shell.append(nav, pane);
  modal.add(shell);
  const controls = new Map<Category, HTMLButtonElement>();
  let active: Category = 'general';

  const save = (patch: PreferencesPatch): Promise<AppState> => window.relay.savePreferences(patch);

  const toggle = (key: keyof GeneralSettings, label: string, help: string): HTMLElement => {
    const row = el('label', 'settings-toggle');
    const copy = el('span', 'settings-copy');
    copy.append(el('strong', '', label), el('small', '', help));
    const input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(getState().preferences.general[key]);
    input.addEventListener('change', () => {
      input.disabled = true;
      void save({ general: { [key]: input.checked } as Partial<GeneralSettings> })
        .then(apply)
        .catch(error => { input.checked = Boolean(getState().preferences.general[key]); modal.fail(error); })
        .finally(() => { input.disabled = false; });
    });
    row.append(copy, input);
    return row;
  };

  const select = <T extends string>(label: string, help: string, values: Array<[T, string]>, current: T, save_: (value: T) => Promise<AppState>): HTMLElement => {
    const row = el('label', 'settings-toggle');
    const copy = el('span', 'settings-copy');
    copy.append(el('strong', '', label), el('small', '', help));
    const control = el('select');
    for (const [value, text] of values) control.append(option(value, text));
    control.value = current;
    control.addEventListener('change', () => {
      control.disabled = true;
      void save_(control.value as T).then(apply)
        .catch(error => { control.value = current; modal.fail(error); })
        .finally(() => { control.disabled = false; });
    });
    row.append(copy, control);
    return row;
  };

  const section = (title: string, ...nodes: Node[]): HTMLElement => {
    const block = el('section', 'settings-section');
    if (title) block.append(el('h3', '', title));
    block.append(...nodes);
    return block;
  };

  const general = (): void => {
    pane.append(
      section('Composer & conversation',
        toggle('inputWhileRunning', 'Input while running', 'Queue a follow-up while the agent is working instead of locking the composer.'),
        toggle('slashCommandDisplay', 'Slash command display', 'Show each command’s description in the composer chip.'),
        toggle('skipUnansweredQuestions', 'Silently skip unanswered questions', 'Dismiss agent questions automatically so a run can finish without waiting for you.'),
        toggle('promptSuggestions', 'Prompt suggestions', 'Offer starter prompts when the composer is empty.'),
        select('Conversation display', 'Choose how much breathing room messages get.', [['comfortable', 'Comfortable'], ['compact', 'Compact']], getState().preferences.general.conversationDisplay,
          value => save({ general: { conversationDisplay: value } })),
        toggle('showThinking', 'Thinking status', 'Show the agent’s reasoning blocks inside each reply.'),
        toggle('goalDriven', 'Goal-driven execution', 'Ask the agent to keep working and verifying until the goal is complete or it is blocked.'),
        toggle('homeGame', 'Home screen game', 'Show a small focus game on the empty home screen.'),
        toggle('skillSuggestions', 'Skill evolution suggestions', 'Suggest unused workspace skills after a turn finishes.'),
        toggle('turnNotifications', 'Turn completion notifications', 'Post a macOS notification when a reply finishes while Relay is in the background.'),
        toggle('turnSound', 'In-app finish chime', 'Ring a soft chime when a reply finishes in the chat. The macOS notification takes over in the background, so you never hear both.'),
      ),
      section('Skill suggestions', skillRegistryRow()),
      section('Files',
        artifactRow(),
      ),
    );
  };

  const skillRegistryRow = (): HTMLElement => {
    const row = el('div', 'settings-field-row');
    const copy = el('div', 'settings-copy');
    copy.append(
      el('strong', '', 'Skill registry URL'),
      el('small', '', 'Relay reads an HTTPS JSON list of { name, url, description?, sha256? } entries and suggests matching skills in Activity, where you can install them for every project. Leave blank to suggest only skills you already have.'),
    );
    const input = el('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = getState().preferences.general.skillRegistry;
    input.placeholder = 'https://example.com/skills.json';
    const form = el('form', 'settings-inline');
    const saveButton = el('button', 'button primary', 'Save registry');
    saveButton.type = 'submit';
    form.append(input, saveButton);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saveButton.disabled) return;
      saveButton.disabled = true;
      void save({ general: { skillRegistry: input.value.trim() } }).then(apply)
        .catch(error => { modal.fail(error); input.value = getState().preferences.general.skillRegistry; })
        .finally(() => { saveButton.disabled = false; });
    });
    row.append(copy, form);
    return row;
  };

  const artifactRow = (): HTMLElement => {
    const row = el('div', 'settings-field-row');
    const copy = el('div', 'settings-copy');
    copy.append(el('strong', '', 'Default artifact file location'), el('small', '', 'Scheduled prompt runs save their Markdown output here. Leave blank to use Relay’s app data folder.'));
    const input = el('input');
    input.type = 'text';
    input.spellcheck = false;
    input.value = getState().preferences.general.artifactDir;
    input.placeholder = 'App data / Relay / artifacts';
    const choose = el('button', 'button', 'Choose folder…');
    choose.type = 'button';
    choose.addEventListener('click', () => {
      choose.disabled = true;
      void window.relay.chooseArtifactDir().then(path => {
        if (!path) return;
        input.value = path;
        return save({ general: { artifactDir: path } }).then(apply);
      }).catch(modal.fail).finally(() => { choose.disabled = false; });
    });
    const form = el('form', 'settings-inline');
    const saveButton = el('button', 'button primary', 'Save folder');
    saveButton.type = 'submit';
    form.append(input, choose, saveButton);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saveButton.disabled) return;
      saveButton.disabled = true;
      void save({ general: { artifactDir: input.value.trim() } }).then(apply)
        .catch(error => { modal.fail(error); input.value = getState().preferences.general.artifactDir; })
        .finally(() => { saveButton.disabled = false; });
    });
    row.append(copy, form);
    return row;
  };

  const appearance = (): void => {
    const choices = el('div', 'theme-cards');
    const themes: Array<[Theme, string, string]> = [
      ['dark', 'Graphite', 'Deep, low-glare surfaces for long sessions.'],
      ['light', 'Porcelain', 'Bright surfaces with crisp ink.'],
      ['system', 'Follow macOS', 'Match your Mac’s light or dark appearance.'],
    ];
    for (const [id, label, description] of themes) {
      const card = el('button', `theme-card ${id}${getState().preferences.theme === id ? ' active' : ''}`);
      card.type = 'button';
      card.append(el('span', `theme-preview ${id}`), el('strong', '', label), el('small', '', description));
      card.addEventListener('click', () => {
        card.disabled = true;
        void save({ theme: id }).then(next => {
          apply(next);
          for (const sibling of choices.children) sibling.classList.toggle('active', sibling === card);
        }).catch(error => modal.fail(error)).finally(() => { card.disabled = false; });
      });
      choices.append(card);
    }
    pane.append(section('Appearance', choices, el('p', 'settings-note', 'Relay follows macOS window chrome and switches instantly without reloading the workspace.')));
  };

  const context = (): void => {
    const threshold = el('input');
    threshold.type = 'number';
    threshold.min = '50';
    threshold.max = '95';
    threshold.step = '5';
    threshold.value = String(getState().preferences.context.compactThreshold);
    threshold.disabled = !getState().preferences.context.autoCompact;
    const row = el('label', 'settings-toggle');
    const copy = el('span', 'settings-copy');
    copy.append(el('strong', '', 'Compact at'), el('small', '', 'When context reaches this percentage, Relay asks the engine to summarize earlier turns automatically.'));
    const suffix = el('span', 'settings-suffix', '%');
    const number = el('span', 'settings-number');
    number.append(threshold, suffix);
    row.append(copy, number);
    threshold.addEventListener('change', () => {
      threshold.disabled = true;
      void save({ context: { compactThreshold: Number(threshold.value) } }).then(apply)
        .catch(error => { threshold.value = String(getState().preferences.context.compactThreshold); modal.fail(error); })
        .finally(() => { threshold.disabled = !getState().preferences.context.autoCompact; });
    });
    const autoRow = el('label', 'settings-toggle');
    const autoCopy = el('span', 'settings-copy');
    autoCopy.append(el('strong', '', 'Auto-compact long conversations'), el('small', '', 'Summarize earlier turns before the task overflows the model window. You can always compact a single task from its usage meter.'));
    const autoInput = el('input');
    autoInput.type = 'checkbox';
    autoInput.checked = getState().preferences.context.autoCompact;
    autoInput.addEventListener('change', () => {
      autoInput.disabled = true;
      void save({ context: { autoCompact: autoInput.checked } }).then(next => {
        apply(next);
        threshold.disabled = !next.preferences.context.autoCompact;
      }).catch(error => { autoInput.checked = getState().preferences.context.autoCompact; modal.fail(error); })
        .finally(() => { autoInput.disabled = false; });
    });
    autoRow.append(autoCopy, autoInput);
    pane.append(section('Compression',
      autoRow,
      row,
      el('p', 'settings-note', 'Compaction keeps a summary card in the conversation so you can see what was replaced. Open the usage meter in any task header to compact on demand.'),
    ));
  };

  const voice = (): void => {
    const copy = el('p', 'settings-note');
    const row = el('div', 'settings-inline');
    const providerControl = el('select');
    const model = el('input');
    model.type = 'text'; model.spellcheck = false; model.maxLength = 256;
    model.placeholder = 'whisper-large-v3-turbo';
    const form = el('form', 'dictation-form');
    const saveButton = el('button', 'button primary', 'Save dictation');
    saveButton.type = 'submit';
    const status = el('div', 'saved-status'); status.setAttribute('role', 'status');
    const supported: ConfigurableProviderID[] = ['groq', 'openai', 'custom', 'lmstudio', 'llamacpp'];
    const suggestions: Partial<Record<ConfigurableProviderID, string>> = {
      groq: 'whisper-large-v3-turbo', openai: 'gpt-4o-mini-transcribe', custom: 'whisper-1', lmstudio: 'whisper-1', llamacpp: 'whisper-1',
    };
    let previousProvider = getState().preferences.dictation.provider;
    const renderDictation = () => {
      const current = getState().preferences.dictation;
      providerControl.replaceChildren();
      for (const id of supported) {
        const configured = getState().providers.some(provider => provider.id === id && (provider.hasKey || providerPreset(id)?.keyless));
        const item = option(id, `${providerName(id)}${configured ? '' : ' · not configured'}`);
        item.disabled = !configured;
        providerControl.append(item);
      }
      providerControl.value = current.provider;
      previousProvider = current.provider;
      model.value = current.model;
      model.placeholder = suggestions[current.provider] ?? 'whisper-1';
      copy.textContent = getState().providers.some(provider => supported.includes(provider.id) && (provider.hasKey || providerPreset(provider.id)?.keyless))
        ? 'Records a short clip with your microphone and sends it to one provider for transcription. Relay does not keep the audio.'
        : 'Add Groq, OpenAI, or a compatible local endpoint in Model providers to enable voice dictation.';
    };
    providerControl.addEventListener('change', () => {
      const next = providerControl.value as ConfigurableProviderID;
      const suggestion = suggestions[next] ?? '';
      if (!model.value.trim() || model.value.trim() === (suggestions[previousProvider] ?? '')) model.value = suggestion;
      model.placeholder = suggestion || 'whisper-1';
      previousProvider = next;
      status.textContent = '';
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saveButton.disabled) return;
      saveButton.disabled = true; status.textContent = 'Saving…';
      void save({ dictation: { provider: providerControl.value as ConfigurableProviderID, model: model.value.trim() } })
        .then(next => { apply(next); renderDictation(); status.textContent = 'Saved. Record from the microphone in the composer.'; })
        .catch(error => { status.textContent = ''; modal.fail(error); })
        .finally(() => { saveButton.disabled = false; });
    });
    renderDictation();
    row.append(providerControl, model);
    form.append(row, saveButton);
    pane.append(section('Voice dictation', copy, form, status));
  };

  const providers = (): void => {
    pane.append(el('p', 'settings-note', 'Your provider configuration is saved locally. Requests are handled by the local OpenCode engine; stored keys are encrypted with the macOS Keychain.'));
    pane.append(el('p', 'small muted', 'The engine already includes free OpenCode models. Add a free-tier provider to unlock more — most need only an API key.'));
    const summaries = el('div', 'provider-summaries');
    const renderSummaries = () => {
      summaries.replaceChildren(...getState().providers.map(provider => {
        const models = provider.models?.length ? ` · ${provider.models.slice(0, 2).join(', ')}${provider.models.length > 2 ? ` +${provider.models.length - 2}` : ''}` : '';
        return el('div', 'provider-summary', `${providerName(provider.id)} · ${provider.hasKey ? 'Key present' : 'No key stored'}${models}`);
      }));
      if (!getState().providers.length) summaries.append(el('p', 'small muted', 'No provider configured yet. Add one below to choose a model.'));
    };
    renderSummaries();
    pane.append(summaries);
    let activeProvider: ConfigurableProviderID = (getState().providers[0]?.id as ConfigurableProviderID | undefined) ?? 'google';
    const gallery = el('div', 'provider-gallery');
    const renderGallery = () => {
      gallery.replaceChildren(...(['free', 'local', 'paid', 'custom'] as const).map(group => {
        const block = el('section', 'provider-group');
        block.append(el('div', 'section-label', groupLabel[group]));
        const cards = el('div', 'provider-cards');
        for (const preset of CONFIGURABLE_PROVIDERS.filter(item => item.group === group)) {
          const saved = getState().providers.find(item => item.id === preset.id);
          const card = button('', () => { activeProvider = preset.id; renderGallery(); updateFields(); form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, `provider-card${activeProvider === preset.id ? ' active' : ''}`);
          const head = el('div', 'provider-card-head');
          head.append(el('strong', '', preset.name));
          if (saved) head.append(el('span', 'pill', saved.hasKey || preset.keyless ? 'Ready' : 'Saved'));
          else if (preset.keyless) head.append(el('span', 'pill', 'No key'));
          card.append(head, el('p', '', preset.description));
          cards.append(card);
        }
        block.append(cards);
        return block;
      }));
    };
    renderGallery();
    pane.append(gallery);
    const form = el('form', 'provider-form');
    const formTitle = el('h3', '', '');
    form.append(formTitle);
    const description = el('p', 'muted');
    const key = el('input'); key.type = 'password'; key.autocomplete = 'new-password'; key.spellcheck = false;
    const baseURL = el('input'); baseURL.type = 'url'; baseURL.spellcheck = false;
    const models = el('textarea'); models.rows = 2; models.spellcheck = false;
    const presence = el('small', 'muted');
    const keyField = field('API key', key, 'Leave blank to keep an existing key. Stored secrets are never shown here.'); keyField.append(presence);
    const baseField = field('Base URL', baseURL, 'Optional endpoint override. Requests run through the engine, not this window.');
    const modelField = field('Model IDs', models, 'One model ID per line. Leave blank to use the provider’s discovered catalog.');
    const actions = el('div', 'dialog-actions');
    const remove = el('button', 'button danger', 'Remove provider'); remove.type = 'button';
    const saveButton = el('button', 'button primary', 'Save provider'); saveButton.type = 'submit';
    const status = el('div', 'saved-status'); status.setAttribute('role', 'status');
    const updateFields = () => {
      const id = activeProvider;
      const preset = providerPreset(id);
      const saved = getState().providers.find(item => item.id === id);
      formTitle.textContent = `Configure ${providerName(id)}`;
      key.value = ''; baseURL.value = saved?.baseURL ?? ''; models.value = (saved?.models ?? []).join('\n');
      description.textContent = preset?.description ?? '';
      presence.textContent = saved?.hasKey ? 'Key present · enter a new key only to replace it' : preset?.keyless ? 'No key needed' : 'No key stored';
      key.placeholder = preset?.keyless ? 'Optional API key' : 'Enter API key';
      keyField.hidden = id === 'custom';
      baseURL.placeholder = preset?.baseURL ?? 'https://…';
      baseField.hidden = !['custom', 'ollama', 'lmstudio', 'llamacpp'].includes(id);
      modelField.hidden = !['custom', 'ollama', 'lmstudio', 'llamacpp'].includes(id);
      models.required = id === 'custom';
      remove.disabled = !saved;
      status.textContent = '';
    };
    updateFields();
    const busy = (value: boolean) => {
      modal.busy(value);
      [key, baseURL, models, saveButton, remove].forEach(control => { control.disabled = value; });
      if (!value) remove.disabled = !getState().providers.some(item => item.id === activeProvider);
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saveButton.disabled) return;
      const input: ProviderInput = { id: activeProvider };
      if (key.value.trim()) input.apiKey = key.value.trim();
      if (!baseField.hidden && baseURL.value.trim()) input.baseURL = baseURL.value.trim();
      const list = models.value.split(/[\n,]/).map(entry => entry.trim()).filter(Boolean);
      if (!modelField.hidden && list.length) input.models = list;
      busy(true); status.textContent = 'Saving…';
      void window.relay.saveProvider(input).then(async state => {
        key.value = ''; apply(state); renderSummaries(); renderGallery(); updateFields();
        status.textContent = 'Saved. Credentials have not been verified by this form.';
        await refreshModels();
      }).catch(error => { status.textContent = ''; modal.fail(error); }).finally(() => busy(false));
    });
    remove.addEventListener('click', () => {
      const id = activeProvider;
      busy(true);
      void (async () => {
        if (!await confirmAction('Remove provider?', `Remove the saved configuration for ${providerName(id)}? Tasks using it may no longer run.`, 'Remove provider')) return;
        apply(await window.relay.removeProvider(id)); renderSummaries(); renderGallery(); updateFields();
        status.textContent = 'Provider removed.'; await refreshModels();
      })().catch(modal.fail).finally(() => busy(false));
    });
    actions.append(remove, saveButton);
    form.append(description, keyField, baseField, modelField, actions, status);
    pane.append(form, button('Refresh available models', async () => { try { await refreshModels(); status.textContent = 'Model list refreshed from the engine.'; } catch (error) { modal.fail(error); } }, 'text-button'));
    modal.root.addEventListener('close', () => { key.value = ''; }, { once: true });
  };

  const archive = (): void => {
    const list = el('div', 'archive-list');
    const note = el('p', 'settings-note', 'Archived tasks keep their conversation and changes but stay out of the task sidebar. Restore one to bring it back.');
    pane.append(section('Archived tasks', note, list));
    const render = (items: SessionSummary[]) => {
      list.replaceChildren();
      if (!items.length) { list.append(el('p', 'small muted', 'No archived tasks.')); return; }
      for (const session of items) {
        const row = el('div', 'archive-row');
        const copy = el('div', 'settings-copy');
        const date = new Date(session.updatedAt);
        copy.append(el('strong', '', session.title), el('small', '', Number.isNaN(date.getTime()) ? 'Archived task' : `Last active ${date.toLocaleString()}`));
        row.append(copy, button('Restore', async () => {
          await window.relay.restoreSession(session.id);
          render(await window.relay.listArchivedSessions());
        }, 'button'));
        list.append(row);
      }
    };
    list.append(el('p', 'small muted', 'Loading archived tasks…'));
    void window.relay.listArchivedSessions().then(render).catch(error => list.replaceChildren(el('p', 'inline-error', errorText(error))));
  };

  const about = (): void => {
    const state = getState();
    const rows = el('div', 'usage-report');
    const row = (label: string, value: string) => {
      const line = el('div', 'usage-row');
      line.append(el('span', '', label), el('span', '', value));
      rows.append(line);
    };
    row('Relay', state.version);
    row('Platform', `${state.platform} · ${state.arch}`);
    row('Engine', `${state.engine.state}${state.engine.version ? ` · ${state.engine.version}` : ''}`);
    row('Workspace', state.workspace?.name ?? 'No project open');
    pane.append(section('About Relay', rows, el('p', 'settings-note', 'Relay is a local-first agent workspace. Conversations, settings, and provider keys stay on this Mac; provider requests go through the local OpenCode engine.')));
  };

  const builders: Record<Category, () => void> = { general, appearance, context, voice, providers, archive, about };

  const show = (category: Category): void => {
    active = category;
    for (const [id, control] of controls) {
      control.classList.toggle('active', id === category);
      control.setAttribute('aria-selected', String(id === category));
    }
    pane.replaceChildren();
    pane.scrollTop = 0;
    modal.fail('');
    builders[category]();
  };

  for (const group of navigation) {
    nav.append(el('div', 'section-label', group.group));
    for (const item of group.items) {
      const control = button(item.label, () => show(item.id), 'settings-nav-item');
      control.setAttribute('role', 'tab');
      controls.set(item.id, control);
      nav.append(control);
    }
  }
  nav.append(el('p', 'settings-nav-foot', `Relay ${getState().version}`));
  show(active);
}
