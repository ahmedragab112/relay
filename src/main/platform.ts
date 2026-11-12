export type Platform = NodeJS.Platform;
export type WindowMaterial = 'vibrancy' | 'mica' | 'solid';

export interface MenuEntry {
  role?: string;
  label?: string;
  accelerator?: string;
  submenu?: MenuEntry[];
}

export interface WindowChrome {
  frame: boolean;
  backgroundColor: string;
  titleBarStyle?: 'hidden' | 'hiddenInset';
  trafficLightPosition?: { x: number; y: number };
  titleBarOverlay?: { color: string; symbolColor: string; height: number };
  vibrancy?: 'under-window';
  visualEffectState?: 'active';
  backgroundMaterial?: 'mica';
}

export function defaultShell(platform: Platform, env: Record<string, string | undefined>): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoLogo'] };
  return { command: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

export function windowMaterial(platform: Platform, release: string): WindowMaterial {
  if (platform === 'darwin') return 'vibrancy';
  if (platform !== 'win32') return 'solid';
  const build = Number(release.split('.').at(-1));
  return Number.isFinite(build) && build >= 22000 ? 'mica' : 'solid';
}

export function windowChrome(platform: Platform, material: WindowMaterial): WindowChrome {
  if (platform === 'darwin') {
    return {
      frame: true,
      backgroundColor: '#00000000',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
    };
  }
  if (platform === 'win32') {
    const glazed = material === 'mica';
    return {
      frame: true,
      backgroundColor: glazed ? '#00000000' : '#202124',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#8f929c', height: 49 },
      ...(glazed ? { backgroundMaterial: 'mica' as const } : {}),
    };
  }
  return { frame: false, backgroundColor: '#202124' };
}

export function applicationMenu(platform: Platform): MenuEntry[] {
  if (platform === 'darwin') return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
  return [
    { label: 'File', submenu: [{ role: 'quit', accelerator: 'CommandOrControl+Q' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

export function credentialStoreLabel(platform: Platform): string {
  if (platform === 'darwin') return 'macOS Keychain';
  if (platform === 'win32') return 'Windows Credential Manager';
  return 'the system keyring';
}

export function accentColor(platform: Platform, value: string): string | undefined {
  if (platform !== 'darwin' && platform !== 'win32') return undefined;
  const match = /^([0-9a-f]{6})[0-9a-f]{2}$/i.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : undefined;
}
