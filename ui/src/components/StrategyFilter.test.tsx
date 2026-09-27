// Ported from __tests__/strategyFilter.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { StrategyFilter, strategyLabel, toggle } from './StrategyFilter';

const OPTIONS = ['Momentum', 'MeanRev', 'Unattributed'];

test('strategyLabel: all', () => expect(strategyLabel('all')).toBe('All'));
test('strategyLabel: single name', () => expect(strategyLabel(['Momentum'])).toBe('Momentum'));
test('strategyLabel: count for 2+', () => expect(strategyLabel(['Momentum', 'MeanRev'])).toBe('2 strategies'));

test('renders the collapsed label', () => {
  render(<StrategyFilter options={OPTIONS} selection="all" onChange={() => {}} />);
  expect(screen.getByTestId('strategy-filter').textContent).toBe('Strategy: All ▾');
});

test('toggle: from all, tapping one option selects just that one', () => {
  const onChange = vi.fn();
  toggle('all', 'Momentum', OPTIONS, onChange);
  expect(onChange).toHaveBeenCalledWith(['Momentum']);
});

test('toggle: removing the last selected option resets to all', () => {
  const onChange = vi.fn();
  toggle(['Momentum'], 'Momentum', OPTIONS, onChange);
  expect(onChange).toHaveBeenCalledWith('all');
});

test('toggle: selecting every option collapses to all', () => {
  const onChange = vi.fn();
  toggle(['Momentum', 'MeanRev'], 'Unattributed', OPTIONS, onChange);
  expect(onChange).toHaveBeenCalledWith('all');
});

test('the menu toggles options and the All row resets', () => {
  const onChange = vi.fn();
  render(<StrategyFilter options={OPTIONS} selection={['Momentum']} onChange={onChange} />);
  fireEvent.click(screen.getByTestId('strategy-filter'));
  expect(screen.getByTestId('strategy-option-Momentum').getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByTestId('strategy-option-MeanRev'));
  expect(onChange).toHaveBeenLastCalledWith(['Momentum', 'MeanRev']);
  fireEvent.click(screen.getByTestId('strategy-all'));
  expect(onChange).toHaveBeenLastCalledWith('all');
});
