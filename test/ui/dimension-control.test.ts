import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DIMENSION,
  parseDimension,
  scrubDimension,
  stepDimension,
} from '../../src/ui/dimension-control.js';

test('dimension text accepts only bounded positive integers', () => {
  assert.equal(parseDimension('2400'), 2400);
  assert.equal(parseDimension(' 1600 '), 1600);
  assert.equal(parseDimension(''), null);
  assert.equal(parseDimension('1.5'), null);
  assert.equal(parseDimension('0'), null);
  assert.equal(parseDimension(String(MAX_DIMENSION + 1)), null);
});

test('dimension stepping and scrubbing clamp to the document bounds', () => {
  assert.equal(stepDimension(1200, 1), 1201);
  assert.equal(stepDimension(1, -1), 1);
  assert.equal(scrubDimension(1200, 24.4), 1224);
  assert.equal(scrubDimension(MAX_DIMENSION, 100), MAX_DIMENSION);
});
