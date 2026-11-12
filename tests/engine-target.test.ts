import test from 'node:test';
import assert from 'node:assert/strict';
import { binaryFormat, engineBinaryName, enginePackageName, engineTarget } from '../src/shared/engine-target.js';

test('engine packages follow the OpenCode npm layout', () => {
  assert.equal(enginePackageName('darwin', 'arm64'), '@opencode/cli-darwin-arm64');
  assert.equal(enginePackageName('darwin', 'x64'), '@opencode/cli-darwin-x64');
  assert.equal(enginePackageName('win32', 'x64'), '@opencode/cli-windows-x64');
  assert.equal(enginePackageName('linux', 'arm64'), '@opencode/cli-linux-arm64');
  assert.equal(enginePackageName('linux', 'x64'), '@opencode/cli-linux-x64');
  assert.throws(() => enginePackageName('freebsd', 'x64'), /does not ship a binary/i);
  assert.throws(() => enginePackageName('linux', 'ia32' as never), /does not ship a binary/i);
});

test('the engine binary carries the platform extension', () => {
  assert.equal(engineBinaryName('win32'), 'opencode.exe');
  assert.equal(engineBinaryName('darwin'), 'opencode');
  assert.equal(engineBinaryName('linux'), 'opencode');
});

test('engineTarget describes the binary a platform pair downloads', () => {
  assert.deepEqual(engineTarget('win32', 'x64'), { platform: 'win32', arch: 'x64', packageName: '@opencode/cli-windows-x64', binary: 'opencode.exe', format: 'pe' });
  assert.deepEqual(engineTarget('darwin', 'arm64'), { platform: 'darwin', arch: 'arm64', packageName: '@opencode/cli-darwin-arm64', binary: 'opencode', format: 'mach-o' });
  assert.deepEqual(engineTarget('linux', 'x64'), { platform: 'linux', arch: 'x64', packageName: '@opencode/cli-linux-x64', binary: 'opencode', format: 'elf' });
  assert.throws(() => engineTarget('aix', 'x64'), /does not ship a binary/i);
});

test('binary formats are detected from magic bytes', () => {
  assert.equal(binaryFormat(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])), 'mach-o');
  assert.equal(binaryFormat(Buffer.from([0xce, 0xfa, 0xed, 0xfe])), 'mach-o');
  assert.equal(binaryFormat(Buffer.from([0xca, 0xfe, 0xba, 0xbe])), 'mach-o');
  assert.equal(binaryFormat(Buffer.from('MZ', 'latin1')), 'pe');
  assert.equal(binaryFormat(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'elf');
  assert.equal(binaryFormat(Buffer.from('#!/bin/sh\n', 'utf8')), 'unknown');
  assert.equal(binaryFormat(Buffer.alloc(2)), 'unknown');
});
