import type { Accent, AppState, GeneralSettings, Layout, ModelOption, PreferencesPatch, ProviderInput, SessionSummary, Theme } from '../shared/contracts';
import { CONFIGURABLE_PROVIDERS, providerName, providerPreset, type ConfigurableProviderID } from '../shared/providers';
import { byId, button, el, errorText, field, option, report } from './dom';
import { confirmAction } from './dialog';
import { applyLanguage } from './i18n';

const groupLabel: Record<string, string> = { free: 'Free', local: 'Local', paid: 'Paid', custom: 'Custom' };
type Category = 'general' | 'appearance' | 'context' | 'auto' | 'voice' | 'providers' | 'archive' | 'about';

const navigation: Array<{ group: string; items: Array<{ id: Category; label: string }> }> = [
  { group: 'Relay', items: [{ id: 'general', label: 'General' }, { id: 'appearance', label: 'Appearance' }, { id: 'context', label: 'Context & usage' }, { id: 'auto', label: 'Auto model' }] },
  { group: 'Connect', items: [{ id: 'voice', label: 'Voice dictation' }, { id: 'providers', label: 'Model providers' }] },
  { group: 'Data', items: [{ id: 'archive', label: 'Archived tasks' }, { id: 'about', label: 'About Relay' }] },
];

let settingsWired = false;

export function closeSettings(): void {
  byId('settings-shell').replaceChildren();
  byId('settings-page').hidden = true;
  byId('app').classList.remove('settings-open');
  byId('settings-button').focus();
}

export function showSettings(getState: () => AppState, apply: (state: AppState) => void, refreshModels: () => Promise<void>): void {
  const page = byId('settings-page');
  if (!settingsWired) {
    settingsWired = true;
    byId('settings-close').addEventListener('click', () => closeSettings());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !page.hidden) { event.preventDefault(); closeSettings(); }
    });
  }
  page.hidden = false;
  byId('app').classList.add('settings-open');
  const shell = el('div', 'settings-shell');
  const nav = el('nav', 'settings-nav');
  nav.setAttribute('aria-label', 'Settings sections');
  const pane = el('div', 'settings-pane');
  shell.append(nav, pane);
  const error = el('p', 'dialog-error settings-error', '');
  error.setAttribute('role', 'alert');
  byId('settings-shell').replaceChildren(error, shell);
  const modal = {
    busy(value: boolean) { byId('settings-close').toggleAttribute('disabled', value); },
    fail(value: unknown) { error.textContent = errorText(value); },
  };
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
        select('Language', 'Switch the interface language. Arabic enables RTL layout.', [['en', 'English'], ['ar', 'العربية — Arabic']], getState().preferences.general.language,
          value => save({ general: { language: value } }).then(next => { apply(next); applyLanguage(next.preferences.general.language); return next; })),
        toggle('turnNotifications', 'Turn completion notifications', 'Post a macOS notification when a reply finishes while Relay is in the background.'),
        toggle('requestNotifications', 'Permission & question notifications', 'Post a macOS notification when the agent needs your approval or asks a question — even while Relay is open.'),
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
    const accents: Array<[Accent, string, string]> = [
      ['blue', 'Relay Blue', '#abc4ff'], ['emerald', 'Emerald', '#8bf0ba'], ['amber', 'Amber', '#f2c879'],
      ['rose', 'Rose', '#f6a6b4'], ['violet', 'Violet', '#c5b6fb'], ['cyan', 'Cyan', '#84d7fa'],
    ];
    const swatches = el('div', 'accent-swatches');
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', 'Accent color');
    for (const [id, label, dot] of accents) {
      const swatch = el('button', `accent-swatch${getState().preferences.general.accent === id ? ' active' : ''}`);
      swatch.type = 'button';
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-checked', String(getState().preferences.general.accent === id));
      swatch.setAttribute('aria-label', label);
      const circle = el('span', 'accent-dot');
      circle.style.background = dot;
      swatch.append(circle, el('span', 'accent-name', label));
      swatch.addEventListener('click', () => {
        swatch.disabled = true;
        void save({ general: { accent: id } }).then(next => {
          apply(next);
          for (const sibling of swatches.children) sibling.classList.toggle('active', sibling === swatch);
        }).catch(error => modal.fail(error)).finally(() => { swatch.disabled = false; });
      });
      swatches.append(swatch);
    }
    const layouts: Array<[Layout, string, string]> = [
      ['tabs', 'Tabs', 'Sidebar, chat and inspector — the full workspace.'],
      ['inbox', 'Inbox', 'Chat only, full width. No inspector.'],
      ['focus', 'Focus', 'Zen mode — centered chat, panels hidden.'],
    ];
    const layoutChoices = el('div', 'layout-cards');
    layoutChoices.setAttribute('role', 'radiogroup');
    layoutChoices.setAttribute('aria-label', 'Layout');
    for (const [id, label, description] of layouts) {
      const card = el('button', `layout-card${getState().preferences.general.layout === id ? ' active' : ''}`);
      card.type = 'button';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(getState().preferences.general.layout === id));
      const preview = el('span', `layout-preview layout-preview-${id}`);
      preview.append(el('span', 'lp-side'), el('span', 'lp-main'), el('span', 'lp-inspector'));
      card.append(preview, el('strong', '', label), el('small', '', description));
      card.addEventListener('click', () => {
        card.disabled = true;
        void save({ general: { layout: id } }).then(next => {
          apply(next);
          for (const sibling of layoutChoices.children) sibling.classList.toggle('active', sibling === card);
        }).catch(error => modal.fail(error)).finally(() => { card.disabled = false; });
      });
      layoutChoices.append(card);
    }
    pane.append(section('Accent & layout', swatches, layoutChoices));
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

  const auto = (): void => {
    const includeRow = el('label', 'settings-toggle');
    const includeCopy = el('span', 'settings-copy');
    includeCopy.append(el('strong', '', 'Include free models'), el('small', '', 'Use free models in auto rotation. Turn off to restrict auto to paid/subscription models.'));
    const includeInput = el('input');
    includeInput.type = 'checkbox';
    includeInput.checked = getState().preferences.auto.includeFree;
    includeInput.addEventListener('change', () => {
      includeInput.disabled = true;
      void save({ auto: { includeFree: includeInput.checked } }).then(apply)
        .catch(error => { includeInput.checked = getState().preferences.auto.includeFree; modal.fail(error); })
        .finally(() => { includeInput.disabled = false; });
    });
    includeRow.append(includeCopy, includeInput);

    const maxTokens = el('input');
    maxTokens.type = 'number';
    maxTokens.min = '256';
    maxTokens.max = '256000';
    maxTokens.step = '256';
    maxTokens.value = String(getState().preferences.auto.maxTokens);
    const maxRow = el('label', 'settings-toggle');
    const maxCopy = el('span', 'settings-copy');
    maxCopy.append(el('strong', '', 'Max tokens per request'), el('small', '', 'Cap the token budget auto mode requests. Lower values avoid credit errors on providers with limited balances.'));
    const maxNumber = el('span', 'settings-number');
    maxNumber.append(maxTokens);
    maxRow.append(maxCopy, maxNumber);
    maxTokens.addEventListener('change', () => {
      maxTokens.disabled = true;
      void save({ auto: { maxTokens: Number(maxTokens.value) } }).then(apply)
        .catch(error => { maxTokens.value = String(getState().preferences.auto.maxTokens); modal.fail(error); })
        .finally(() => { maxTokens.disabled = false; });
    });

    const modelList = el('div', 'auto-model-list');
    const modelField = el('div', 'field auto-model-field');
    modelField.append(el('span', 'field-label', 'Allowed models'), modelList,
      el('small', '', 'Check or uncheck connected models. All checked = every connected model (the default). Auto rotates through the checked models in cost order.'));
    const renderAllowedModels = async (): Promise<void> => {
      modelList.replaceChildren(el('p', 'small muted', 'Loading models…'));
      const models = await window.relay.listModels().catch(() => [] as ModelOption[]);
      const connected = models.filter(item => item.connected);
      if (!connected.length) {
        modelList.replaceChildren(el('p', 'small muted', 'No connected models yet — configure a provider first.'));
        return;
      }
      const saved = getState().preferences.auto.modelIds;
      const current = (): Set<string> => new Set(getState().preferences.auto.modelIds.length ? getState().preferences.auto.modelIds : connected.map(item => item.id));
      modelList.replaceChildren(...connected.map(item => {
        const row = el('label', 'auto-model-row');
        const copy = el('span', 'auto-model-copy');
        copy.append(el('strong', '', item.name), el('small', '', `${item.id}${item.free ? ' · free' : ''}${item.limited ? ' · limit reached' : ''}`));
        const input = el('input');
        input.type = 'checkbox';
        input.checked = saved.length ? saved.includes(item.id) : true;
        input.setAttribute('aria-label', `Include ${item.name}`);
        input.addEventListener('change', () => {
          const next = current();
          if (input.checked) next.add(item.id); else next.delete(item.id);
          const list = next.size === connected.length ? [] : [...next];
          void save({ auto: { modelIds: list } }).catch(modal.fail);
        });
        row.append(input, copy);
        return row;
      }));
    };
    void renderAllowedModels();

    pane.append(section('Auto model rotation',
      includeRow,
      maxRow,
      modelField,
      el('p', 'settings-note', 'Auto mode picks the lowest-cost connected model and rotates to the next one when a request fails (rate limits, credits, or invalid models). Use the allowed list to restrict which models may be tried.'),
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
    const keyLink = el('button', 'text-button', 'Get an API key ↗');
    keyLink.type = 'button';
    keyLink.hidden = true;
    keyLink.addEventListener('click', () => {
      const preset = providerPreset(activeProvider);
      if (preset?.keyUrl) void window.relay.openExternal(preset.keyUrl).catch(error => report('Could not open link', error));
    });
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
      keyLink.hidden = !preset?.keyUrl;
      keyLink.textContent = preset?.keyUrl ? `Get an API key for ${preset.name} ↗` : '';
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
        status.textContent = 'Saved. Checking whether the engine lists connected models…';
        await refreshModels();
        try {
          const connected = (await window.relay.listModels()).filter(model => model.providerID === activeProvider && model.connected);
          status.textContent = connected.length
            ? `Saved — engine lists ${connected.length} connected model${connected.length === 1 ? '' : 's'} for ${providerName(activeProvider)}.`
            : 'Saved, but the engine reports no connected models for this provider — check the API key and base URL.';
        } catch { status.textContent = 'Saved, but the model list could not be refreshed.'; }
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
    form.append(description, keyLink, keyField, baseField, modelField, actions, status);
    pane.append(form, button('Refresh available models', async () => { try { await refreshModels(); status.textContent = 'Model list refreshed from the engine.'; } catch (error) { modal.fail(error); } }, 'text-button'));
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

  const builders: Record<Category, () => void> = { general, appearance, context, auto, voice, providers, archive, about };

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

  const NAV_ICONS: Record<Category, string[]> = {
    general: ['<circle cx="12" cy="12" r="3.2"/>', '<path d="M12 3.5v2.6M12 17.9v2.6M20.5 12h-2.6M6.1 12H3.5M17.8 6.2 16 8M8 16l-1.8 1.8M17.8 17.8 16 16M8 8 6.2 6.2"/>'],
    appearance: ['<path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z"/>'],
    context: ['<path d="M4.5 14.5a8 8 0 1 1 15 0"/>', '<path d="M12 14.5 15.5 9"/>', '<circle cx="12" cy="14.5" r="1.4"/>'],
    auto: ['<path d="M12 4l1.4 3.6L17 9l-3.6 1.4L12 14l-1.4-3.6L7 9l3.6-1.4L12 4z"/>', '<path d="M18.2 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z"/>'],
    voice: ['<rect x="9" y="3" width="6" height="11" rx="3"/>', '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'],
    providers: ['<path d="M9 4v5M15 4v5M7 9h10v3a5 5 0 0 1-10 0V9zM12 17v3"/>'],
    archive: ['<rect x="4" y="5" width="16" height="5" rx="1.5"/>', '<path d="M6 10v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7M10.5 13.5h3"/>'],
    about: ['<circle cx="12" cy="12" r="8.5"/>', '<path d="M12 11v5"/>', '<circle cx="12" cy="8.2" r=".6" fill="currentColor" stroke="none"/>'],
  };
  const navIcon = (category: Category): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('settings-nav-icon');
    for (const fragment of NAV_ICONS[category]) {
      const template = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      template.innerHTML = fragment;
      for (const node of [...template.childNodes]) svg.append(node);
    }
    return svg;
  };

  for (const group of navigation) {
    nav.append(el('div', 'section-label', group.group));
    for (const item of group.items) {
      const control = button('', () => show(item.id), 'settings-nav-item');
      control.setAttribute('role', 'tab');
      control.append(navIcon(item.id), el('span', 'settings-nav-label', item.label));
      controls.set(item.id, control);
      nav.append(control);
    }
  }
  nav.append(el('p', 'settings-nav-foot', `Relay ${getState().version}`));
  show(active);
}
