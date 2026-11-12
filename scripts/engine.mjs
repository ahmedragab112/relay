import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, open, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { binaryFormat, engineTarget } from '../src/shared/engine-target.ts';

const registry = process.env.RELAY_NPM_REGISTRY ?? 'https://registry.npmjs.org';

function cacheName(target) {
  return `cli-${target.packageName.slice('@opencode/cli-'.length)}`;
}

async function download(url, file) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Could not download ${url} (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

async function validate(file, target, version) {
  const size = (await stat(file)).size;
  if (size < 1024 * 1024) throw new Error(`${file} is only ${size} bytes; that is not an OpenCode binary.`);
  const handle = await open(file, 'r');
  const head = Buffer.alloc(4);
  try {
    await handle.read(head, 0, 4, 0);
  } finally {
    await handle.close();
  }
  const format = binaryFormat(head);
  if (format !== target.format) throw new Error(`${file} is ${format}, expected ${target.format} for ${target.platform}-${target.arch}.`);
  if (target.platform === 'darwin' && process.platform === 'darwin') {
    const archs = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
    const expected = target.arch === 'x64' ? 'x86_64' : 'arm64';
    if (!archs.includes(expected)) throw new Error(`${file} is ${archs.join(', ')}, expected ${expected}.`);
  }
  if (target.platform === process.platform && target.arch === process.arch) {
    const reported = execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 60_000 }).trim();
    if (!reported.includes(version)) throw new Error(`OpenCode reported ${reported || 'no version'}, expected ${version}.`);
    return reported;
  }
  return version;
}

export async function stageEngine({ root, platform = process.platform, arch = process.arch, version }) {
  if (!version) throw new Error('An OpenCode version is required to stage the engine.');
  const target = engineTarget(platform, arch);
  const cache = join(root, 'build', 'vendor', cacheName(target));
  const binary = join(cache, 'package', 'bin', target.binary);
  const installed = join(root, 'node_modules', target.packageName, 'bin', target.binary);
  let source = existsSync(installed) ? installed : existsSync(binary) ? binary : undefined;
  if (!source) {
    const tarball = join(root, 'build', 'vendor', `opencode-${cacheName(target)}-${version}.tgz`);
    if (!existsSync(tarball)) {
      const url = `${registry}/${target.packageName}/-/${cacheName(target)}-${version}.tgz`;
      console.log(`Fetching ${target.packageName}@${version}`);
      try {
        await download(url, tarball);
      } catch (error) {
        await rm(tarball, { force: true });
        throw error;
      }
    }
    await mkdir(cache, { recursive: true });
    try {
      execFileSync('tar', ['-xzf', tarball, '-C', cache], { stdio: 'inherit' });
    } catch {
      throw new Error(`Could not unpack ${tarball}. Install tar and retry, or pre-stage ${target.packageName}.`);
    }
    if (!existsSync(binary)) throw new Error(`${target.packageName} did not contain ${target.binary}.`);
    source = binary;
  }
  await validate(source, target, version);
  const engine = join(root, 'build', 'engine', target.binary);
  await mkdir(join(root, 'build', 'engine'), { recursive: true });
  const other = join(root, 'build', 'engine', target.platform === 'win32' ? 'opencode' : 'opencode.exe');
  await rm(other, { force: true });
  await copyFile(source, engine);
  if (target.platform !== 'win32') await chmod(engine, 0o755);
  const size = (await stat(engine)).size;
  console.log(`Staged OpenCode ${version} for ${target.platform}-${target.arch} (${(size / 1024 / 1024).toFixed(0)} MB)`);
  return { target, path: engine, version };
}
