import { execFile } from 'node:child_process';
import { lstat, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const result = await run('git', args, { cwd: root, maxBuffer: 1_000_000 });
  return result.stdout;
}

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('The file is outside the selected workspace.');
}

export async function undoFileChange(root: string, input: string): Promise<'restored' | 'deleted'> {
  if (typeof input !== 'string' || !input || input.includes('\0') || isAbsolute(input)) throw new Error('Use a relative path inside the workspace.');
  const base = await realpath(root);
  const target = resolve(base, input);
  assertInside(base, target);
  const exists = await lstat(target).then(info => info.isFile(), () => false);
  if (exists) {
    const real = await realpath(target);
    assertInside(base, real);
  }
  try { await git(base, ['rev-parse', '--show-toplevel']); }
  catch { throw new Error('Undo needs this project to be a Git repository.'); }
  const path = relative(base, target);
  let tracked = true;
  try { await git(base, ['ls-files', '--error-unmatch', '--', path]); }
  catch { tracked = false; }
  if (!tracked) {
    if (!exists) throw new Error('That file is no longer in the workspace.');
    await rm(target);
    return 'deleted';
  }
  const inHead = (await git(base, ['ls-tree', 'HEAD', '--', path])).trim().length > 0;
  if (!inHead) {
    await git(base, ['rm', '--cached', '--force', '--', path]);
    if (exists) await rm(target);
    return 'deleted';
  }
  await git(base, ['checkout', 'HEAD', '--', path]);
  return 'restored';
}
