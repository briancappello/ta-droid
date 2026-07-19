// __tests__/strategyFilter.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StrategyFilter, strategyLabel, toggle } from '../src/components/StrategyFilter';

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

test('toggle: from all, tapping one option selects just that one', () => {
  const onChange = jest.fn();
  toggle('all', 'Momentum', ['Momentum', 'MeanRev', 'Unattributed'], onChange);
  expect(onChange).toHaveBeenCalledWith(['Momentum']);
});

test('toggle: removing the last selected option resets to all', () => {
  const onChange = jest.fn();
  toggle(['Momentum'], 'Momentum', ['Momentum', 'MeanRev', 'Unattributed'], onChange);
  expect(onChange).toHaveBeenCalledWith('all');
});

test('toggle: selecting every option collapses to all', () => {
  const onChange = jest.fn();
  toggle(['Momentum', 'MeanRev'], 'Unattributed', ['Momentum', 'MeanRev', 'Unattributed'], onChange);
  expect(onChange).toHaveBeenCalledWith('all');
});
