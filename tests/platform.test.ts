import test from 'node:test';
import assert from 'node:assert/strict';
import { accentColor, applicationMenu, credentialStoreLabel, defaultShell, windowChrome, windowMaterial } from '../src/main/platform.js';

test('each platform gets its own login shell', () => {
  assert.deepEqual(defaultShell('darwin', {}), { command: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(defaultShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }), { command: '/opt/homebrew/bin/fish', args: ['-l'] });
  assert.deepEqual(defaultShell('linux', {}), { command: '/bin/bash', args: ['-l'] });
  assert.deepEqual(defaultShell('linux', { SHELL: '/usr/bin/fish' }), { command: '/usr/bin/fish', args: ['-l'] });
  assert.deepEqual(defaultShell('win32', { COMSPEC: 'C:\\Windows\\system32\\cmd.exe' }), { command: 'powershell.exe', args: ['-NoLogo'] });
});

test('window materials depend on the OS and its version', () => {
  assert.equal(windowMaterial('darwin', '25.6.0'), 'vibrancy');
  assert.equal(windowMaterial('win32', '10.0.22631'), 'mica');
  assert.equal(windowMaterial('win32', '10.0.19045'), 'solid');
  assert.equal(windowMaterial('linux', '6.8.0'), 'solid');
});

test('window chrome follows each platform convention', () => {
  const mac = windowChrome('darwin', 'vibrancy');
  assert.equal(mac.titleBarStyle, 'hiddenInset');
  assert.deepEqual(mac.trafficLightPosition, { x: 16, y: 18 });
  assert.equal(mac.vibrancy, 'under-window');
  assert.equal(mac.backgroundMaterial, undefined);

  const windows = windowChrome('win32', 'mica');
  assert.equal(windows.titleBarStyle, 'hidden');
  assert.equal(windows.backgroundMaterial, 'mica');
  assert.ok(windows.titleBarOverlay);
  assert.equal(windows.trafficLightPosition, undefined);

  const olderWindows = windowChrome('win32', 'solid');
  assert.equal(olderWindows.backgroundMaterial, undefined);
  assert.equal(olderWindows.backgroundColor, '#202124');

  const linux = windowChrome('linux', 'solid');
  assert.equal(linux.frame, false);
  assert.equal(linux.titleBarStyle, undefined);
  assert.equal(linux.backgroundMaterial, undefined);
  assert.equal(linux.vibrancy, undefined);
});

test('windows and linux get a File menu with quit; macOS keeps the app menu', () => {
  const mac = applicationMenu('darwin');
  assert.equal(mac[0].role, 'appMenu');
  assert.equal(mac.some(item => item.label === 'File'), false);

  for (const platform of ['win32', 'linux'] as const) {
    const menu = applicationMenu(platform);
    assert.equal(menu.some(item => item.role === 'appMenu'), false);
    const file = menu.find(item => item.label === 'File');
    assert.ok(file?.submenu);
    const quit = file.submenu.find(item => item.role === 'quit');
    assert.ok(quit);
    assert.equal(quit.accelerator, 'CommandOrControl+Q');
  }
});

test('the OS accent color is normalized where the OS exposes one', () => {
  assert.equal(accentColor('darwin', '0a84ffff'), '#0A84FF');
  assert.equal(accentColor('win32', '0078D4FF'), '#0078D4');
  assert.equal(accentColor('linux', '0a84ffff'), undefined);
  assert.equal(accentColor('darwin', ''), undefined);
  assert.equal(accentColor('darwin', 'nonsense'), undefined);
});

test('credential messages name the platform keystore', () => {
  assert.equal(credentialStoreLabel('darwin'), 'macOS Keychain');
  assert.equal(credentialStoreLabel('win32'), 'Windows Credential Manager');
  assert.equal(credentialStoreLabel('linux'), 'the system keyring');
});
