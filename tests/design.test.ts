import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLORS, DESIGN_BRIEF, DESIGN_ENTRY, DESIGN_ROOT, designCssVariables, designPrompt, designSessionTitle, designSlug, designSystemCss, previewScroll, sameDesignURL,
  designTitle, implementPrompt, isDesignSession, isDesignSlug, nextVersion, normalizeDesignSystem, defaultDesignSystem,
} from '../src/shared/design.js';

test('a design name becomes a safe folder slug', () => {
  assert.equal(designSlug('Checkout Flow'), 'checkout-flow');
  assert.equal(designSlug('  Café  Menu  '), 'cafe-menu');
  assert.equal(designSlug('v2 — Pricing / Pro!'), 'v2-pricing-pro');
  assert.equal(designSlug('a'.repeat(80)).length, 48);
  assert.throws(() => designSlug('   '), /letters or numbers/);
  assert.throws(() => designSlug('***'), /letters or numbers/);
});

test('slugs are validated for paths coming from the renderer', () => {
  assert.equal(isDesignSlug('checkout-flow'), true);
  assert.equal(isDesignSlug('../etc'), false);
  assert.equal(isDesignSlug('a/b'), false);
  assert.equal(isDesignSlug(''), false);
  assert.equal(isDesignSlug(42), false);
});

test('titles are humanized from slugs', () => {
  assert.equal(designTitle('checkout-flow'), 'Checkout flow');
  assert.equal(designTitle('landing'), 'Landing');
});

test('a stored design system is completed and clamped', () => {
  const system = normalizeDesignSystem({
    name: '  Acme  ',
    notes: 'Keep it airy.',
    colors: { primary: '#FF0000', background: 'javascript:alert(1)' },
    type: { heading: 'Inter; color:red', base: 200, scale: 9 },
    shape: { space: -4, radius: 999, shadow: '0 1px 2px #000}; body{display:none' },
  });
  assert.equal(system.name, 'Acme');
  assert.equal(system.notes, 'Keep it airy.');
  assert.equal(system.colors.primary, '#ff0000');
  assert.equal(system.colors.background, DEFAULT_COLORS.background);
  assert.equal(system.type.heading, 'Inter colorred');
  assert.equal(system.type.base, 22);
  assert.equal(system.type.scale, 1.6);
  assert.equal(system.shape.space, 2);
  assert.equal(system.shape.radius, 48);
  assert.ok(!system.shape.shadow.includes('{'));
});

test('garbage storage falls back to the default system', () => {
  assert.deepEqual(normalizeDesignSystem(undefined), defaultDesignSystem());
  assert.deepEqual(normalizeDesignSystem('nope'), defaultDesignSystem());
  assert.deepEqual(normalizeDesignSystem([1, 2]), defaultDesignSystem());
});

test('the token block names every design decision', () => {
  const system = normalizeDesignSystem({});
  const css = designCssVariables(system);
  for (const name of ['--ds-background', '--ds-primary', '--ds-font-heading', '--ds-base', '--ds-scale', '--ds-space', '--ds-radius', '--ds-shadow']) {
    assert.ok(css.includes(name), name);
  }
  assert.ok(designSystemCss(system).startsWith(':root{--ds-background:'));
});

test('version numbers continue after the highest saved one', () => {
  assert.equal(nextVersion([]), 1);
  assert.equal(nextVersion([1, 2, 3]), 4);
  assert.equal(nextVersion([1, 5, 2]), 6);
});

test('design sessions are labelled and recognisable', () => {
  assert.equal(designSessionTitle('checkout-flow'), 'Design · Checkout flow');
  assert.equal(isDesignSession({ title: 'Design · Checkout flow' }), true);
  assert.equal(isDesignSession({ title: 'Checkout flow' }), false);
});

test('the generation prompt pins the sandbox, tokens and request', () => {
  const system = normalizeDesignSystem({ name: 'Acme', notes: 'Airy, calm.' });
  const prompt = designPrompt({ projectName: 'Shop', slug: 'checkout', request: 'A two-column checkout', system, existing: [], revision: false });
  assert.ok(prompt.includes(`${DESIGN_ROOT}/checkout/`));
  assert.ok(prompt.includes(`${DESIGN_ROOT}/checkout/${DESIGN_ENTRY}`));
  assert.ok(prompt.includes('--ds-primary:#4f8cff'));
  assert.ok(prompt.includes('Airy, calm.'));
  assert.ok(prompt.includes('A two-column checkout'));
  assert.ok(prompt.includes('Create the page from scratch.'));
  assert.ok(prompt.includes('offline'));
});

test('the prompt plans the direction in DESIGN.md before writing any code', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'A two-column checkout',
    system: normalizeDesignSystem({}), existing: [], revision: false,
  });
  assert.ok(prompt.includes(`${DESIGN_ROOT}/checkout/${DESIGN_BRIEF}`));
  assert.ok(prompt.indexOf(`${DESIGN_ROOT}/checkout/${DESIGN_BRIEF}`) < prompt.indexOf('styl'));
  assert.ok(/before (you )?(write|writ)/i.test(prompt), 'the brief must come before building');
  assert.ok(prompt.includes('signature element'));
  assert.ok(prompt.includes('cream'), 'names the generic defaults to avoid');
  assert.ok(prompt.includes('hex'));
});

test('the prompt splits pages into complete files with relative navigation', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'Site with pricing', system: normalizeDesignSystem({}),
    existing: [], revision: false,
  });
  assert.ok(prompt.includes('styles.css'));
  assert.ok(prompt.includes('one HTML file per screen'));
  assert.ok(prompt.includes('relative links only'));
  assert.ok(prompt.includes('Never write a partial file') || prompt.includes('Write complete files'));
  assert.ok(prompt.includes('lorem'));
  assert.ok(prompt.includes('390'));
});

test('the prompt finishes with a self-check pass over every screen', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'A checkout', system: normalizeDesignSystem({}),
    existing: [], revision: false,
  });
  assert.ok(prompt.includes('browser tool'));
  assert.ok(prompt.includes('1280'));
  assert.ok(prompt.includes('every navigation link'));
  assert.ok(prompt.includes('two or three sentences'));
});

test('preview navigation messages are accepted only for the current design', () => {
  assert.equal(sameDesignURL('relay-design://preview/checkout/about.html', 'checkout'), 'relay-design://preview/checkout/about.html');
  assert.equal(
    sameDesignURL('relay-design://preview/checkout/about.html?raw=1#team', 'checkout'),
    'relay-design://preview/checkout/about.html#team',
  );
  for (const value of [
    'relay-design://preview/other/about.html',
    'https://example.com/about.html',
    'javascript:alert(1)',
    'relay-design://preview/checkout/../secret.html',
    'relay-design://preview/checkout/%2e%2e/secret.html',
    'relay-design://preview/checkout/styles.css',
    '',
  ]) {
    assert.equal(sameDesignURL(value, 'checkout'), null, value);
  }
});

test('scroll messages are clamped to something scrollable', () => {
  assert.equal(previewScroll(240.7), 240);
  assert.equal(previewScroll(-5), 0);
  assert.equal(previewScroll('nope'), 0);
  assert.equal(previewScroll(1e12), 1_000_000);
});

test('revision prompts name the existing files', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'Make the button larger', system: normalizeDesignSystem({}),
    existing: ['index.html', 'style.css'], revision: true,
  });
  assert.ok(prompt.includes('index.html, style.css'));
  assert.ok(prompt.includes('Revise the existing design'));
  assert.ok(prompt.includes('Read'));
  assert.ok(prompt.includes(DESIGN_BRIEF));
  assert.ok(prompt.includes('targeted'));
  assert.ok(!prompt.includes('Create the page from scratch.'));
});

test('the implement prompt reads the sandbox and follows project conventions', () => {
  const prompt = implementPrompt({ slug: 'checkout', title: 'Checkout' });
  assert.ok(prompt.includes(`${DESIGN_ROOT}/checkout/`));
  assert.ok(prompt.includes('.relay/design-system.json'));
  assert.ok(prompt.includes('project conventions'));
});
