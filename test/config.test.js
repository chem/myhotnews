import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCount } from '../src/config.js';

test('parseCount: handles K suffix', () => {
  assert.equal(parseCount('1.5K'), 1500);
  assert.equal(parseCount('2k'), 2000);
});

test('parseCount: handles M suffix', () => {
  assert.equal(parseCount('1.2M'), 1200000);
});

test('parseCount: handles plain numbers and commas', () => {
  assert.equal(parseCount('47'), 47);
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount(''), 0);
  assert.equal(parseCount(null), 0);
});
