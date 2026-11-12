export type FileIconKind =
  | 'file' | 'typescript' | 'react' | 'javascript' | 'json' | 'html' | 'css'
  | 'markdown' | 'shell' | 'python' | 'image' | 'npm' | 'lock' | 'git' | 'docker'
  | 'settings' | 'license' | 'folder' | 'folder-open' | 'git-folder' | 'package-folder';

export interface FileIconSpec {
  kind: FileIconKind;
  color: string;
}

const TYPES: Record<string, FileIconSpec> = {
  ts: { kind: 'typescript', color: '#519aba' },
  mts: { kind: 'typescript', color: '#519aba' },
  cts: { kind: 'typescript', color: '#519aba' },
  tsx: { kind: 'react', color: '#53bde7' },
  jsx: { kind: 'react', color: '#53bde7' },
  js: { kind: 'javascript', color: '#cbcb41' },
  mjs: { kind: 'javascript', color: '#cbcb41' },
  cjs: { kind: 'javascript', color: '#cbcb41' },
  json: { kind: 'json', color: '#cbcb41' },
  jsonc: { kind: 'json', color: '#cbcb41' },
  html: { kind: 'html', color: '#e37933' },
  htm: { kind: 'html', color: '#e37933' },
  css: { kind: 'css', color: '#42a5f5' },
  scss: { kind: 'css', color: '#cf649a' },
  sass: { kind: 'css', color: '#cf649a' },
  less: { kind: 'css', color: '#519aba' },
  md: { kind: 'markdown', color: '#519aba' },
  mdx: { kind: 'markdown', color: '#519aba' },
  sh: { kind: 'shell', color: '#89e051' },
  bash: { kind: 'shell', color: '#89e051' },
  zsh: { kind: 'shell', color: '#89e051' },
  fish: { kind: 'shell', color: '#89e051' },
  py: { kind: 'python', color: '#3572a5' },
  pyi: { kind: 'python', color: '#3572a5' },
  png: { kind: 'image', color: '#a074c4' },
  jpg: { kind: 'image', color: '#a074c4' },
  jpeg: { kind: 'image', color: '#a074c4' },
  gif: { kind: 'image', color: '#a074c4' },
  webp: { kind: 'image', color: '#a074c4' },
  svg: { kind: 'image', color: '#a074c4' },
  ico: { kind: 'image', color: '#a074c4' },
  lock: { kind: 'lock', color: '#cbcb41' },
};

const NAMES: Record<string, FileIconSpec> = {
  'package.json': { kind: 'npm', color: '#cb3837' },
  'package-lock.json': { kind: 'lock', color: '#cbcb41' },
  'yarn.lock': { kind: 'lock', color: '#cbcb41' },
  'pnpm-lock.yaml': { kind: 'lock', color: '#cbcb41' },
  'tsconfig.json': { kind: 'typescript', color: '#519aba' },
  'jsconfig.json': { kind: 'javascript', color: '#cbcb41' },
  '.gitignore': { kind: 'git', color: '#e37933' },
  '.gitattributes': { kind: 'git', color: '#e37933' },
  '.gitmodules': { kind: 'git', color: '#e37933' },
  dockerfile: { kind: 'docker', color: '#2496ed' },
  'docker-compose.yml': { kind: 'docker', color: '#2496ed' },
  'docker-compose.yaml': { kind: 'docker', color: '#2496ed' },
  '.env': { kind: 'settings', color: '#cbcb41' },
  'vite.config.ts': { kind: 'settings', color: '#a074c4' },
  'vite.config.js': { kind: 'settings', color: '#a074c4' },
  'vitest.config.ts': { kind: 'settings', color: '#a074c4' },
  'eslint.config.js': { kind: 'settings', color: '#a074c4' },
  '.eslintrc': { kind: 'settings', color: '#a074c4' },
  license: { kind: 'license', color: '#cbcb41' },
  'license.md': { kind: 'license', color: '#cbcb41' },
  'license.txt': { kind: 'license', color: '#cbcb41' },
};

const FOLDERS: Record<string, FileIconSpec> = {
  '.git': { kind: 'git-folder', color: '#e37933' },
  node_modules: { kind: 'package-folder', color: '#8bc34a' },
};

export function fileIcon(name: string, directory: boolean, open = false): FileIconSpec {
  const lower = name.toLowerCase();
  if (directory) {
    const special = FOLDERS[lower];
    if (special) return special;
    return open ? { kind: 'folder-open', color: '#90a4ae' } : { kind: 'folder', color: '#90a4ae' };
  }
  const known = NAMES[lower];
  if (known) return known;
  if (lower.startsWith('.env.')) return { kind: 'settings', color: '#cbcb41' };
  const dot = lower.lastIndexOf('.');
  const extension = dot > 0 ? lower.slice(dot + 1) : '';
  return TYPES[extension] ?? { kind: 'file', color: '#d0d0d0' };
}

const SVG_OPEN = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">';
const PAGE = (color: string) =>
  `<path d="M3.6 1.5h5.2l3.6 3.6v9.4h-8.8z" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>` +
  `<path d="M8.7 1.7v3.6h3.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>`;
const BADGE = (label: string, color: string, size = 4.3) =>
  `${SVG_OPEN}${PAGE(color)}<text x="8" y="12.5" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="${size}" font-weight="700" fill="${color}">${label}</text></svg>`;
const FOLDER = (color: string) =>
  `${SVG_OPEN}<path d="M1.6 4.3c0-.5.4-.9.9-.9h3.4l1.3 1.5h6.3c.5 0 .9.4.9.9v6.5c0 .5-.4.9-.9.9H2.5a.9.9 0 0 1-.9-.9z" fill="${color}" fill-opacity=".9"/></svg>`;
const FOLDER_OPEN = (color: string) =>
  `${SVG_OPEN}<path d="M1.6 4.8c0-.5.4-.9.9-.9h3.4l1.3 1.5h5.6c.5 0 .9.4.9.9v1H4.6L1.6 13z" fill="${color}" fill-opacity=".55"/>` +
  `<path d="M4.7 7.3h9.5l-1.5 6.2c-.1.4-.4.6-.8.6H2.6c-.5 0-.9-.4-.9-.9V8.2c0-.5.4-.9.9-.9z" fill="${color}" fill-opacity=".9"/></svg>`;
const REACT = (color: string) =>
  `${SVG_OPEN}<circle cx="8" cy="8" r="1.2" fill="${color}"/>` +
  `<g fill="none" stroke="${color}" stroke-width=".95"><ellipse cx="8" cy="8" rx="6" ry="2.4"/><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(60 8 8)"/><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(120 8 8)"/></g></svg>`;
const IMAGE = (color: string) =>
  `${SVG_OPEN}<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.2" fill="none" stroke="${color}" stroke-width="1"/>` +
  `<circle cx="5.6" cy="6.3" r="1" fill="${color}"/><path d="M3 11.4l3-3 2.1 2.1 1.9-1.9 2.9 2.8" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round"/></svg>`;
const LOCK = (color: string) =>
  `${SVG_OPEN}<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.1" fill="${color}" fill-opacity=".9"/>` +
  `<path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
const GIT = (color: string) =>
  `${SVG_OPEN}<g fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"><circle cx="5" cy="3.6" r="1.5"/><circle cx="5" cy="12.4" r="1.5"/><circle cx="11.2" cy="5.6" r="1.5"/><path d="M5 5.1v5.8M11.2 7.1c0 2.5-2.2 3.2-4.6 3.6"/></g></svg>`;
const DOCKER = (color: string) =>
  `${SVG_OPEN}<g fill="${color}"><rect x="2.2" y="7.3" width="2.6" height="2.4" rx=".4"/><rect x="5.3" y="7.3" width="2.6" height="2.4" rx=".4"/><rect x="8.4" y="7.3" width="2.6" height="2.4" rx=".4"/><rect x="5.3" y="4.5" width="2.6" height="2.4" rx=".4"/><rect x="8.4" y="4.5" width="2.6" height="2.4" rx=".4"/><path d="M1.4 10.5h12.1c-.4 2.1-1.9 3.3-4.2 3.3H5.6c-2 0-3.6-1.2-4.2-3.3z"/></g></svg>`;
const SETTINGS = (color: string) =>
  `${SVG_OPEN}<g fill="none" stroke="${color}" stroke-width="1.1"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.9v2M8 12.1v2M1.9 8h2M12.1 8h2M3.7 3.7l1.4 1.4M10.9 10.9l1.4 1.4M12.3 3.7l-1.4 1.4M5.1 10.9l-1.4 1.4"/></g></svg>`;
const LICENSE = (color: string) =>
  `${SVG_OPEN}${PAGE(color)}<path d="M5.4 7.2h5.2M5.4 9h5.2M5.4 10.8h3.4" stroke="${color}" stroke-width=".9" stroke-linecap="round"/></svg>`;

const GLYPHS: Record<FileIconKind, (color: string) => string> = {
  file: color => BADGE('', color),
  typescript: color => BADGE('TS', color),
  react: REACT,
  javascript: color => BADGE('JS', color),
  json: color => BADGE('{ }', color, 3.9),
  html: color => BADGE('&lt;/&gt;', color, 3.2),
  css: color => BADGE('#', color, 5),
  markdown: color => BADGE('M↓', color, 4),
  shell: color => BADGE('&gt;_', color, 3.6),
  python: color => BADGE('Py', color),
  image: IMAGE,
  npm: color => BADGE('N', color, 5),
  lock: LOCK,
  git: GIT,
  docker: DOCKER,
  settings: SETTINGS,
  license: LICENSE,
  folder: FOLDER,
  'folder-open': FOLDER_OPEN,
  'git-folder': FOLDER,
  'package-folder': FOLDER,
};

export function fileIconElement(name: string, directory: boolean, open = false): HTMLElement {
  const spec = fileIcon(name, directory, open);
  const element = document.createElement('span');
  element.className = 'file-icon';
  element.innerHTML = GLYPHS[spec.kind](spec.color);
  return element;
}
