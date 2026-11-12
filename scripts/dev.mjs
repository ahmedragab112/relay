import { createServer } from 'vite';
import { build as bundle } from 'esbuild';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import electronPath from 'electron';
import { stageEngine } from './engine.mjs';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({ configFile: join(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error('Vite did not report a local URL.');
server.printUrls();

const shared = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], logLevel: 'warning', sourcemap: 'inline' };
await bundle({ ...shared, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(root, 'dist/main/index.cjs') });
await bundle({ ...shared, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(root, 'dist/preload/index.cjs') });

const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies['@opencode/cli'];
await stageEngine({ root, version });

const child = spawn(electronPath, [root], { cwd: root, stdio: 'inherit', env: { ...process.env, RELAY_DEV_URL: url } });
const stop = async () => {
  child.kill();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
