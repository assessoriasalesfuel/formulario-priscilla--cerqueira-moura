import test from 'node:test';
import assert from 'node:assert/strict';
import { trackCustomEvent, trackStandardEvent } from '../public/js/tracking.js';

test('envia eventos ao Pixel e impede duplicidade por chave', () => {
  const calls = [];
  globalThis.fbq = (...args) => calls.push(args);
  assert.equal(trackCustomEvent('FormStepCompleted', { step_number: 1 }, 'test-step-once'), true);
  assert.equal(trackCustomEvent('FormStepCompleted', { step_number: 1 }, 'test-step-once'), false);
  assert.equal(trackStandardEvent('Lead', {}, 'test-lead-once'), true);
  assert.deepEqual(calls, [
    ['trackCustom', 'FormStepCompleted', { step_number: 1 }],
    ['track', 'Lead', {}],
  ]);
  delete globalThis.fbq;
});

test('não interrompe o formulário quando o Pixel estiver indisponível', () => {
  delete globalThis.fbq;
  assert.equal(trackCustomEvent('FormStarted', {}, 'test-pixel-unavailable'), false);
});
