import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Browser } from '@opencode/plugin-browser/rpc';
import { Engine } from '../src/main/engine.js';

const root = await mkdtemp(join(tmpdir(), 'relay-browser-spike-'));
const workspace = join(root, 'project');
await mkdir(workspace);
await writeFile(join(workspace, 'a.txt'), 'hi');
const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), () => {});
try {
  await engine.start(workspace, [], []);
  const session = await engine.createSession('spike');
  console.log('session:', session.id);

  const rpc = (engine.client as any).rpc(Browser.Definition);
  const location = { directory: workspace };
  const attachment = { sessionID: session.id, connectionID: crypto.randomUUID() };

  const controls: any[] = [];
  const stop = rpc.events.on('control', (event: any) => {
    controls.push(event);
    console.log('control event:', JSON.stringify(event).slice(0, 160));
  }, { location });

  const attach = rpc.attach({ ...attachment, version: 4 }, { location }).then(
    (outcome: unknown) => console.log('attach resolved:', JSON.stringify(outcome)),
    (cause: unknown) => console.log('attach REJECTED:', JSON.stringify(cause)),
  );

  await new Promise((r) => setTimeout(r, 500));
  try {
    const ack = await rpc.state({ ...attachment, state: { tabs: [], focusedTabID: null } }, { location });
    console.log('state acked:', JSON.stringify(ack));
  } catch (cause) {
    console.log('state REJECTED:', JSON.stringify(cause));
  }

  await new Promise((r) => setTimeout(r, 4000));
  console.log('controls seen:', controls.length, controls.map(c => c.type ?? '?').join(','));
  stop();
  console.log(controls.length >= 1 ? 'SPIKE_OK' : 'SPIKE_NO_ATTACH_EVENT');
} finally {
  await engine.stop().catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
