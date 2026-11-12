import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { skillIdFromName } from '../src/main/skills.js';
import { skillSeeds } from './catalog/skills.js';
import { pluginSeeds } from './catalog/plugins.js';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COMMAND = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DESCRIPTION = 600;

const skillsRoot = join(process.cwd(), 'bundled-skills');
const pluginsRoot = join(process.cwd(), 'catalog');

function check(count: number, label: string): void {
  if (count !== 100) throw new Error(`Expected 100 ${label}, found ${count}.`);
}

function unique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

check(skillSeeds.length, 'skills');
check(pluginSeeds.length, 'plugins');
unique(skillSeeds.map((entry) => entry.id), 'skill id');
unique(pluginSeeds.map((entry) => entry.id), 'plugin id');

for (const entry of skillSeeds) {
  if (!ID.test(entry.id)) throw new Error(`Unsafe skill id: ${entry.id}`);
  if (skillIdFromName(entry.name) !== entry.id) throw new Error(`Skill ${entry.id} must derive its id from the name “${entry.name}”.`);
  if (!entry.description.trim() || entry.description.length > MAX_DESCRIPTION) throw new Error(`Skill ${entry.id} needs a description of 600 characters or fewer.`);
  if (!entry.category.trim()) throw new Error(`Skill ${entry.id} needs a category.`);
  if (!entry.body.trim()) throw new Error(`Skill ${entry.id} needs instructions.`);
}

for (const entry of pluginSeeds) {
  if (!ID.test(entry.id)) throw new Error(`Unsafe plugin id: ${entry.id}`);
  if (!entry.name.trim() || entry.name.length > 80) throw new Error(`Plugin ${entry.id} needs a name of 80 characters or fewer.`);
  if (!entry.description.trim() || entry.description.length > 400) throw new Error(`Plugin ${entry.id} needs a description of 400 characters or fewer.`);
  if (entry.commands.length < 2) throw new Error(`Plugin ${entry.id} needs at least two commands.`);
  unique(entry.commands.map((item) => item.name), `command name in ${entry.id}`);
  for (const item of entry.commands) {
    if (!COMMAND.test(item.name)) throw new Error(`Plugin ${entry.id} has an unsafe command name: ${item.name}`);
    if (!item.description.trim() || item.description.length > 200) throw new Error(`Command ${entry.id}/${item.name} needs a description.`);
    if (!item.body.trim()) throw new Error(`Command ${entry.id}/${item.name} needs instructions.`);
  }
}

await rm(skillsRoot, { recursive: true, force: true });
await rm(pluginsRoot, { recursive: true, force: true });

const perCategory = new Map<string, number>();
for (const entry of [...skillSeeds].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) {
  const order = (perCategory.get(entry.category) ?? 0) + 1;
  perCategory.set(entry.category, order);
  const directory = join(skillsRoot, entry.id);
  await mkdir(directory, { recursive: true });
  const text = [
    '---',
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `category: ${entry.category}`,
    `order: ${order}`,
    '---',
    '',
    entry.body.trim(),
    '',
  ].join('\n');
  await writeFile(join(directory, 'SKILL.md'), text);
}

for (const entry of pluginSeeds) {
  const directory = join(pluginsRoot, entry.id);
  await mkdir(join(directory, 'commands'), { recursive: true });
  await writeFile(join(directory, 'relay-plugin.json'), `${JSON.stringify({
    id: entry.id,
    name: entry.name,
    version: '1.0.0',
    description: entry.description,
  }, null, 2)}\n`);
  await writeFile(join(directory, 'README.md'), `# ${entry.name}\n\n${entry.description}\n`);
  for (const item of entry.commands) {
    const text = ['---', `description: ${item.description}`, '---', '', item.body.trim(), ''].join('\n');
    await writeFile(join(directory, 'commands', `${item.name}.md`), text);
  }
}

console.log(`Wrote ${skillSeeds.length} bundled skills and ${pluginSeeds.length} catalog plugins.`);
