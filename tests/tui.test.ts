import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_OPEN, NEEDS_TTY, SETUP_REQUIRED, appGate, autoApproval, helpText, opencodeArgs, parseDescriptor,
  parseLauncherArgs, resolveWorkspace, ttyGate,
} from '../src/cli/tui.js';

test('parseLauncherArgs reads leading flags and leaves engine arguments alone', () => {
  assert.equal(parseLauncherArgs(['-h']).help, true);
  assert.equal(parseLauncherArgs(['--version']).version, true);
  const auto = parseLauncherArgs(['--auto', 'run', '--help']);
  assert.equal(auto.auto, true);
  assert.equal(auto.help, false);
  assert.deepEqual(auto.rest, ['run', '--help']);
  const forced = parseLauncherArgs(['--force', '--no-auto']);
  assert.equal(forced.force, true);
  assert.equal(forced.auto, false);
  assert.deepEqual(forced.rest, []);
  assert.equal(parseLauncherArgs(['models']).auto, undefined);
});

test('parseLauncherArgs only treats a lone install as the install command', () => {
  assert.equal(parseLauncherArgs(['install']).install, true);
  assert.equal(parseLauncherArgs(['install', '--force']).install, false);
  assert.deepEqual(parseLauncherArgs(['install', '--force']).rest, ['install', '--force']);
});

test('parseDescriptor validates the app descriptor and defaults access to ask', () => {
  const descriptor = parseDescriptor(JSON.stringify({
    version: '0.1.0', binary: '/app/opencode', root: '/state/engine', config: '/state/engine/opencode.json', access: 'auto', pid: 42,
  }));
  assert.deepEqual(descriptor, {
    version: '0.1.0', binary: '/app/opencode', root: '/state/engine', config: '/state/engine/opencode.json', access: 'auto', pid: 42,
  });
  assert.equal(parseDescriptor(JSON.stringify({ binary: 'b', root: 'r', config: 'c', access: 'nonsense' })).access, 'ask');
  assert.equal(parseDescriptor(JSON.stringify({ binary: 'b', root: 'r', config: 'c' })).version, 'unknown');
});

test('parseDescriptor rejects corrupt or incomplete files with the setup message', () => {
  assert.throws(() => parseDescriptor('not json'), new RegExp(SETUP_REQUIRED.slice(0, 30)));
  assert.throws(() => parseDescriptor(JSON.stringify({ binary: 'b', root: 'r' })), /terminal launcher/);
  assert.throws(() => parseDescriptor('null'), /terminal launcher/);
});

test('autoApproval follows Relay access unless the flag overrides it', () => {
  assert.equal(autoApproval('auto', undefined), true);
  assert.equal(autoApproval('full', undefined), true);
  assert.equal(autoApproval('ask', undefined), false);
  assert.equal(autoApproval('read', undefined), false);
  assert.equal(autoApproval('read', true), true);
  assert.equal(autoApproval('full', false), false);
});

test('opencodeArgs runs standalone and only adds --auto where the engine accepts it', () => {
  assert.deepEqual(opencodeArgs([], false), ['--standalone']);
  assert.deepEqual(opencodeArgs([], true), ['--standalone', '--auto']);
  assert.deepEqual(opencodeArgs(['run', 'Fix it'], true), ['--standalone', 'run', '--auto', 'Fix it']);
  assert.deepEqual(opencodeArgs(['run', 'Fix it'], false), ['--standalone', 'run', 'Fix it']);
  assert.deepEqual(opencodeArgs(['models'], true), ['--standalone', 'models']);
});

test('resolveWorkspace treats an existing folder as the workspace', () => {
  const workspace = resolveWorkspace(['./app', 'run', 'Fix it'], (path) => path === './app');
  assert.equal(workspace.directory, './app');
  assert.deepEqual(workspace.rest, ['run', 'Fix it']);
  assert.equal(workspace.error, undefined);
  assert.deepEqual(resolveWorkspace([], () => false), { rest: [] });
});

test('resolveWorkspace passes commands through and rejects missing paths', () => {
  const command = resolveWorkspace(['run', 'Fix it'], () => false);
  assert.equal(command.directory, undefined);
  assert.deepEqual(command.rest, ['run', 'Fix it']);
  assert.match(resolveWorkspace(['./missing'], () => false).error ?? '', /No folder at/);
  assert.match(resolveWorkspace(['/missing'], () => false).error ?? '', /No folder at/);
  assert.match(resolveWorkspace(['C:\\Relay'], () => false).error ?? '', /No folder at/);
});

test('appGate blocks a running app unless forced', () => {
  assert.equal(appGate({ force: false, appRunning: true }), APP_OPEN);
  assert.equal(appGate({ force: true, appRunning: true }), undefined);
  assert.equal(appGate({ force: false, appRunning: false }), undefined);
});

test('ttyGate requires a command outside an interactive terminal', () => {
  assert.equal(ttyGate({ interactive: false, engineArgs: [] }), NEEDS_TTY);
  assert.equal(ttyGate({ interactive: false, engineArgs: ['run', 'Fix it'] }), undefined);
  assert.equal(ttyGate({ interactive: true, engineArgs: [] }), undefined);
});

test('helpText documents every launch mode', () => {
  const help = helpText();
  for (const line of ['relay install', 'relay <folder>', '--auto', '--no-auto', '--force', '--version']) {
    assert.ok(help.includes(line), `missing ${line}`);
  }
});
