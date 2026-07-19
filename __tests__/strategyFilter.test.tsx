// __tests__/strategyFilter.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StrategyFilter, strategyLabel } from '../src/components/StrategyFilter';

test('strategyLabel: all', () => {
  expect(strategyLabel('all')).toBe('All');
});
test('strategyLabel: single name', () => {
  expect(strategyLabel(['Momentum'])).toBe('Momentum');
});
test('strategyLabel: count for 2+', () => {
  expect(strategyLabel(['Momentum', 'MeanRev'])).toBe('2 strategies');
});

test('renders the collapsed label', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <StrategyFilter
        options={['Momentum', 'MeanRev', 'Unattributed']}
        selection="all"
        onChange={() => {}}
      />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('All');
});
