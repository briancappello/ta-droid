// Ported from __tests__/format.test.ts.
import { expect, test } from 'vitest';
import { formatMoney, formatPercent } from './format';

test('formatMoney uses 2 decimals for prices >= $1', () => {
  expect(formatMoney(16.19999999999999)).toBe('16.20');
  expect(formatMoney(-3.749000000000009)).toBe('-3.75');
});

test('formatMoney uses 4 decimals when the reference price is under $1', () => {
  expect(formatMoney(0.42)).toBe('0.4200');
  expect(formatMoney(-0.0217999999, 0.42)).toBe('-0.0218');
});

test('formatMoney keys precision off the reference price, not the value', () => {
  expect(formatMoney(0.6295999, 0.63)).toBe('0.6296');
  expect(formatMoney(0.02, 150)).toBe('0.02');
});

test('formatPercent is always 2 decimals', () => {
  expect(formatPercent(-12.538699690402469)).toBe('-12.54');
  expect(formatPercent(112.34832262669521)).toBe('112.35');
});
