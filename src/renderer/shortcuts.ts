const macSymbols: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab' };
const plainNames: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab' };

export function modifierLabel(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl';
}

export function shortcutLabel(platform: string, combo: string): string {
  const parts = combo.split('+').filter(Boolean);
  if (platform === 'darwin') return parts.map((part) => macSymbols[part] ?? part).join('');
  return parts.map((part) => plainNames[part] ?? part).join('+');
}
