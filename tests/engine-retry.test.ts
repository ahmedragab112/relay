import test from 'node:test';
import assert from 'node:assert/strict';
import { retryActivation } from '../src/main/engine.js';

test('retries while the engine is still activating plugins', async () => {
  let attempts = 0;
  const result = await retryActivation(async () => {
    attempts++;
    if (attempts < 3) throw new Error('ServiceUnavailableError: Location plugins did not finish activating');
    return 'models';
  }, 1);
  assert.equal(result, 'models');
  assert.equal(attempts, 3);
});

test('does not retry unrelated failures', async () => {
  let attempts = 0;
  await assert.rejects(() => retryActivation(async () => {
    attempts++;
    throw new Error('Unauthorized');
  }, 1));
  assert.equal(attempts, 1);
});

test('gives up after the bounded attempts', async () => {
  let attempts = 0;
  await assert.rejects(
    () => retryActivation(async () => {
      attempts++;
      throw new Error('Location plugins did not finish activating');
    }, 1, 3),
    /did not finish activating/,
  );
  assert.equal(attempts, 3);
});
