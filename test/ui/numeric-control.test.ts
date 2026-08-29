import assert from 'node:assert/strict';
import test from 'node:test';
import {
  numericScrubStep,
  parseNumericInput,
  scrubNumericValue,
} from '../../src/ui/numeric-control.js';

test('numeric text parsing respects integer and range contracts', () => {
  assert.equal(parseNumericInput('0.75', { maximum: 1, minimum: 0 }), 0.75);
  assert.equal(parseNumericInput('', { maximum: 1, minimum: 0 }), null);
  assert.equal(parseNumericInput('1.5', { integer: true }), null);
  assert.equal(parseNumericInput('2', { maximum: 1, minimum: 0 }), null);
});

test('numeric label scrubbing selects useful precision and clamps values', () => {
  assert.equal(numericScrubStep({ maximum: 1, minimum: 0 }), 0.01);
  assert.equal(numericScrubStep({ maximum: 20, minimum: -20 }), 0.1);
  assert.equal(numericScrubStep({ maximum: 100, minimum: -100 }), 1);
  assert.equal(numericScrubStep({ maximum: 1000, minimum: -1000, scrubStep: 0.01 }), 0.01);
  assert.equal(scrubNumericValue(0.5, 25, { maximum: 1, minimum: 0 }), 0.75);
  assert.equal(scrubNumericValue(0.5, 25, { maximum: 1, minimum: 0 }, true), 0.525);
  assert.equal(scrubNumericValue(0, 10, { integer: true, maximum: 5, minimum: 0 }), 5);
});
