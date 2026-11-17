import { posix, win32 } from 'node:path';

/** Environment for an engine process that shares Relay's state without touching the user's dotfiles. */
export function sidecarEnvironment(root: string, password: string, configPath: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const path = platform === 'win32' ? win32 : posix;
  const home = path.join(root, 'home');
  const pick = (...names: string[]) => names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!] as const]));
  const fallbackPath = platform === 'win32'
    ? process.env.PATH || process.env.Path || ''
    : '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const env: NodeJS.ProcessEnv = Object.fromEntries([
    ['HOME', home],
    ['XDG_CONFIG_HOME', path.join(root, 'config')],
    ['XDG_DATA_HOME', path.join(root, 'data')],
    ['XDG_CACHE_HOME', path.join(root, 'cache')],
    ['XDG_STATE_HOME', path.join(root, 'state')],
    ...(platform === 'win32' ? [
      ['USERPROFILE', home],
      ['APPDATA', path.join(home, 'AppData', 'Roaming')],
      ['LOCALAPPDATA', path.join(home, 'AppData', 'Local')],
    ] : []),
    ['OPENCODE_CONFIG_DIR', path.join(root, 'config', 'opencode')],
    ['OPENCODE_CONFIG', configPath],
    ['OPENCODE_CONFIG_PROJECT_DISABLE', '1'],
    ['OPENCODE_DISABLE_CLAUDE_CODE', '1'],
    ['OPENCODE_PASSWORD', password],
    ['OPENCODE_CLIENT', 'relay'],
    ['PATH', process.env.PATH || fallbackPath],
    ...pick('TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL', 'USER', 'LOGNAME'),
  ]);
  return env;
}
