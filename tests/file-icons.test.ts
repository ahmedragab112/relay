import test from 'node:test';
import assert from 'node:assert/strict';
import { fileIcon } from '../src/renderer/file-icons.js';

test('code and markup files use their own Material colors', () => {
  assert.deepEqual(fileIcon('main.ts', false), { kind: 'typescript', color: '#519aba' });
  assert.deepEqual(fileIcon('main.tsx', false), { kind: 'react', color: '#53bde7' });
  assert.deepEqual(fileIcon('main.js', false), { kind: 'javascript', color: '#cbcb41' });
  assert.deepEqual(fileIcon('main.jsx', false), { kind: 'react', color: '#53bde7' });
  assert.deepEqual(fileIcon('data.json', false), { kind: 'json', color: '#cbcb41' });
  assert.deepEqual(fileIcon('page.html', false), { kind: 'html', color: '#e37933' });
  assert.deepEqual(fileIcon('styles.css', false), { kind: 'css', color: '#42a5f5' });
  assert.deepEqual(fileIcon('README.md', false), { kind: 'markdown', color: '#519aba' });
  assert.deepEqual(fileIcon('run.sh', false), { kind: 'shell', color: '#89e051' });
  assert.deepEqual(fileIcon('main.py', false), { kind: 'python', color: '#3572a5' });
});

test('well-known file names win over their extension', () => {
  assert.deepEqual(fileIcon('package.json', false), { kind: 'npm', color: '#cb3837' });
  assert.deepEqual(fileIcon('package-lock.json', false), { kind: 'lock', color: '#cbcb41' });
  assert.deepEqual(fileIcon('tsconfig.json', false), { kind: 'typescript', color: '#519aba' });
  assert.deepEqual(fileIcon('.gitignore', false), { kind: 'git', color: '#e37933' });
  assert.deepEqual(fileIcon('Dockerfile', false), { kind: 'docker', color: '#2496ed' });
  assert.deepEqual(fileIcon('.env', false), { kind: 'settings', color: '#cbcb41' });
  assert.deepEqual(fileIcon('vite.config.ts', false), { kind: 'settings', color: '#a074c4' });
  assert.deepEqual(fileIcon('LICENSE', false), { kind: 'license', color: '#cbcb41' });
});

test('extensions match regardless of case and images get the picture icon', () => {
  assert.deepEqual(fileIcon('Main.TS', false), { kind: 'typescript', color: '#519aba' });
  assert.deepEqual(fileIcon('LOGO.svg', false), { kind: 'image', color: '#a074c4' });
  assert.deepEqual(fileIcon('photo.PNG', false), { kind: 'image', color: '#a074c4' });
  assert.deepEqual(fileIcon('unknown.bin', false), { kind: 'file', color: '#d0d0d0' });
  assert.deepEqual(fileIcon('notes', false), { kind: 'file', color: '#d0d0d0' });
});

test('folders show closed and open Material folder icons', () => {
  assert.deepEqual(fileIcon('src', true), { kind: 'folder', color: '#90a4ae' });
  assert.deepEqual(fileIcon('src', true, true), { kind: 'folder-open', color: '#90a4ae' });
  assert.deepEqual(fileIcon('.git', true), { kind: 'git-folder', color: '#e37933' });
  assert.deepEqual(fileIcon('node_modules', true), { kind: 'package-folder', color: '#8bc34a' });
});
