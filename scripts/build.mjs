import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { mkdir, readFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stageEngine } from './engine.mjs';

const root = resolve(import.meta.dirname, '..');
const platform = process.env.RELAY_TARGET_PLATFORM || process.platform;
const arch = process.env.RELAY_TARGET_ARCH || process.arch;
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = packageJson.devDependencies['@opencode/cli'];

await rm(join(root, 'dist'), { recursive: true, force: true });
await rm(join(root, 'build', 'engine'), { recursive: true, force: true });
await mkdir(join(root, 'build', 'engine'), { recursive: true });

console.log('Building renderer');
await viteBuild({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });

const shared = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], logLevel: 'warning', sourcemap: false };
console.log('Building main process');
await bundle({ ...shared, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(root, 'dist/main/index.cjs') });
console.log('Building preload bridge');
await bundle({ ...shared, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(root, 'dist/preload/index.cjs') });
console.log('Building export encoder');
await bundle({ ...shared, entryPoints: [join(root, 'src/preload/export.ts')], outfile: join(root, 'dist/preload/export.cjs') });

console.log('Building relayctl');
const relayctl = join(root, 'dist', 'relayctl.mjs');
await bundle({
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'warning',
  sourcemap: false,
  entryPoints: [join(root, 'src/cli/index.ts')],
  outfile: relayctl,
  banner: { js: '#!/usr/bin/env node' },
});
await chmod(relayctl, 0o755);

console.log('Building relay launcher');
const relay = join(root, 'dist', 'relay.mjs');
await bundle({
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'warning',
  sourcemap: false,
  entryPoints: [join(root, 'src/cli/relay.ts')],
  outfile: relay,
  banner: { js: '#!/usr/bin/env node' },
});
await chmod(relay, 0o755);

const { target } = await stageEngine({ root, platform, arch, version });
console.log(`Relay build complete for ${target.platform}-${target.arch}`);
