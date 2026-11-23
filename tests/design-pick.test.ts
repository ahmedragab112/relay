import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedElement } from '../src/shared/design.js';

test('a picked element becomes a labelled context block', () => {
  const picked = pickedElement({
    selector: 'main > section.hero > h1.hero-title:nth-of-type(1)',
    tag: 'h1',
    classes: 'hero-title display',
    text: 'Ship a calmer checkout',
    width: 720.4,
    height: 96.8,
    styles: { 'font-family': 'Iowan Old Style, serif', 'font-size': '56px', color: 'rgb(27, 26, 23)' },
  });
  assert.ok(picked);
  assert.match(picked.label, /h1/);
  assert.match(picked.label, /hero-title/);
  assert.match(picked.text, /main > section\.hero > h1\.hero-title/);
  assert.match(picked.text, /Ship a calmer checkout/);
  assert.match(picked.text, /720×97/);
  assert.match(picked.text, /font-size: 56px/);
});

test('a picked element ignores junk, scripts and oversized values', () => {
  assert.equal(pickedElement(null), undefined);
  assert.equal(pickedElement('element'), undefined);
  assert.equal(pickedElement({ tag: '<script>' }), undefined);
  const picked = pickedElement({
    selector: `<img src=x onerror=alert(1)> ${'a'.repeat(500)}`,
    tag: 'img',
    classes: `<b>${'c'.repeat(200)}`,
    text: `  hello\n\n<b>world</b>  ${'d'.repeat(400)}`,
    width: -5,
    height: 100_000,
    styles: {
      color: 'red',
      '</style><script>': 'x',
      'font-size': `1${'0'.repeat(300)}`,
      display: 42,
    },
  });
  assert.ok(picked);
  assert.ok(!picked.text.includes('<'));
  assert.ok(!picked.text.includes('javascript:'));
  assert.ok(picked.text.length < 1200);
  assert.match(picked.text, /hello/);
  assert.match(picked.text, /0×10000/);
  assert.match(picked.text, /color: red/);
  assert.ok(!picked.text.includes('script'));
});

test('an element without a selector falls back to its tag', () => {
  const picked = pickedElement({ selector: '', tag: 'button', classes: '', text: '', width: 0, height: 0, styles: {} });
  assert.deepEqual(picked, { label: 'Element button', text: 'Tag: button\nSize: 0×0' });
});
