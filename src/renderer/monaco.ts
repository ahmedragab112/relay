import type * as Monaco from 'monaco-editor';

let loading: Promise<typeof Monaco> | undefined;
const workers = new Set<Worker>();
let disposed = false;

function workerFor(label: string): Worker {
  switch (label) {
    case 'typescript':
    case 'javascript':
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' });
    case 'json':
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' });
    case 'css':
    case 'scss':
    case 'less':
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' });
    case 'html':
    case 'handlebars':
    case 'razor':
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' });
    default:
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });
  }
}

export function loadMonaco(): Promise<typeof Monaco> {
  loading ??= import('monaco-editor').then((monaco) => {
    if (disposed) throw new Error('Editor has been closed');
    window.MonacoEnvironment = { getWorker(_moduleId, label) {
      const instance = workerFor(label);
      workers.add(instance);
      return instance;
    } };
    for (const [name, base, background, foreground, line] of [
      ['relay-dark', 'vs-dark', '#1c1d20', '#ececef', '#34353a'],
      ['relay-light', 'vs', '#f7f8fa', '#252730', '#d9dce4'],
    ] as const) {
      monaco.editor.defineTheme(name, { base, inherit: true, rules: [], colors: {
        'editor.background': background, 'editor.foreground': foreground,
        'editorLineNumber.foreground': '#818590', 'editor.lineHighlightBorder': line,
        'editorGutter.background': background, 'editorWidget.background': background,
      } });
    }
    monaco.editor.setTheme(document.documentElement.dataset.theme === 'light' ? 'relay-light' : 'relay-dark');
    return monaco;
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

export function editorTheme(light: boolean): void {
  if (loading) void loading.then(monaco => monaco.editor.setTheme(light ? 'relay-light' : 'relay-dark')).catch(() => {});
}

export function language(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go', sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', java: 'java', xml: 'xml', toml: 'ini' } as Record<string, string>)[ext] ?? 'plaintext';
}

export function disposeWorkers(): void {
  disposed = true;
  workers.forEach(worker => worker.terminate()); workers.clear();
  delete window.MonacoEnvironment;
}
