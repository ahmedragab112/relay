import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanVoiceText } from '../src/renderer/state.js';

test('removes filler words and collapses spaces', () => {
  assert.equal(cleanVoiceText('um, basically, the model should like run faster'), 'The model should run faster.');
});

test('capitalizes the first letter and ends with a period', () => {
  assert.equal(cleanVoiceText('hello world'), 'Hello world.');
});

test('keeps existing punctuation', () => {
  assert.equal(cleanVoiceText('does this work?'), 'Does this work?');
});

test('handles empty input', () => {
  assert.equal(cleanVoiceText('   '), '');
});

test('removes stray spaces before punctuation', () => {
  assert.equal(cleanVoiceText('hello , world !'), 'Hello, world!');
});