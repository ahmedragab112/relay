import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_SYSTEM_PRESETS, DESIGN_TEMPLATES, applyDesignSystemPreset, defaultDesignSkills, defaultDesignSystem,
  designExtras, designTemplate,
} from '../src/shared/design.js';
import type { SkillOption } from '../src/shared/contracts.js';

const skill = (id: string, name: string): SkillOption => ({ id, name, description: '' });

test('design extras are trimmed, deduped and capped', () => {
  const extras = designExtras({
    files: [' a.css ', 'a.css', '', 3, 'b.css', ...Array.from({ length: 12 }, (_, index) => `f${index}.css`)],
    skills: ['design-systems', 'design-systems', null, 'accessibility'],
    agents: ['reviewer', 'reviewer'],
    context: [
      { label: ' Brand ', text: ' Warm and calm ' },
      { label: '', text: 'ignored' },
      { label: 'x'.repeat(200), text: 'y'.repeat(5000) },
    ],
  });
  assert.equal(extras.files.length, 10);
  assert.deepEqual(extras.files.slice(0, 3), ['a.css', 'b.css', 'f0.css']);
  assert.deepEqual(extras.skills, ['design-systems', 'accessibility']);
  assert.deepEqual(extras.agents, ['reviewer']);
  assert.deepEqual(extras.context[0], { label: 'Brand', text: 'Warm and calm' });
  assert.equal(extras.context.length, 2);
  assert.equal(extras.context[1]?.label.length, 120);
  assert.equal(extras.context[1]?.text.length, 4000);
});

test('missing or junk extras become empty lists', () => {
  assert.deepEqual(designExtras(undefined), { files: [], skills: [], agents: [], context: [] });
  assert.deepEqual(designExtras('nope'), { files: [], skills: [], agents: [], context: [] });
  assert.deepEqual(designExtras({ files: 'a.css', context: {} }), { files: [], skills: [], agents: [], context: [] });
});

test('design turns start with the craft skills that are actually installed', () => {
  const installed = [
    skill('/skills/forms', 'Forms'),
    skill('/skills/react', 'React'),
    skill('/skills/ux-copy', 'UX copy'),
    skill('/skills/accessibility', 'Accessibility'),
    skill('/skills/design-systems', 'Design systems'),
  ];
  assert.deepEqual(defaultDesignSkills(installed), [
    '/skills/design-systems', '/skills/accessibility', '/skills/ux-copy', '/skills/forms',
  ]);
  assert.deepEqual(defaultDesignSkills([]), []);
  assert.deepEqual(defaultDesignSkills([skill('react', 'React')]), []);
});

test('every template carries a distinct, concrete brief', () => {
  assert.ok(DESIGN_TEMPLATES.length >= 5);
  const ids = new Set(DESIGN_TEMPLATES.map((template) => template.id));
  const briefs = new Set(DESIGN_TEMPLATES.map((template) => template.brief));
  assert.equal(ids.size, DESIGN_TEMPLATES.length);
  assert.equal(briefs.size, DESIGN_TEMPLATES.length);
  for (const template of DESIGN_TEMPLATES) {
    assert.ok(template.name.length > 2);
    assert.ok(template.summary.length > 8);
    assert.ok(template.brief.length > 80, `${template.id} brief is too thin`);
    assert.equal(designTemplate(template.id)?.id, template.id);
  }
  assert.equal(designTemplate('nope'), undefined);
});

test('system presets are complete, distinct and safe to store', () => {
  assert.ok(DESIGN_SYSTEM_PRESETS.length >= 4);
  const ids = new Set(DESIGN_SYSTEM_PRESETS.map((preset) => preset.id));
  assert.equal(ids.size, DESIGN_SYSTEM_PRESETS.length);
  for (const preset of DESIGN_SYSTEM_PRESETS) {
    for (const value of Object.values(preset.colors)) assert.match(value, /^#[0-9a-f]{6}$/);
    assert.ok(preset.type.heading && preset.type.body && preset.type.mono);
    assert.ok(preset.shape.space >= 2 && preset.shape.radius >= 0);
    assert.ok(preset.notes.length > 10);
  }
});

test('applying a preset keeps the project name and replaces the visual system', () => {
  const current = { ...defaultDesignSystem(), name: 'Acme' };
  const preset = DESIGN_SYSTEM_PRESETS[0]!;
  const next = applyDesignSystemPreset(current, preset);
  assert.equal(next.name, 'Acme');
  assert.deepEqual(next.colors, preset.colors);
  assert.deepEqual(next.type, preset.type);
  assert.deepEqual(next.shape, preset.shape);
  assert.equal(next.notes, preset.notes);
});
