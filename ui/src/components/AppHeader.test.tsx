// Ported from __tests__/appHeader.test.tsx.
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BackendProvider, useBackend, type HealthByBackend } from '../state/backend';
import { AppHeader } from './AppHeader';
import { useEffect } from 'react';

function WithHealth({ h }: { h: HealthByBackend }) {
  const { setHealth } = useBackend();
  useEffect(() => setHealth(h), [h, setHealth]);
  return <AppHeader title="Positions" onMenuPress={() => {}} />;
}

test('renders the title and per-backend MS/FA chips', () => {
  render(
    <BackendProvider>
      <WithHealth h={{ marketstore: 'up', fatechan: 'up' }} />
    </BackendProvider>,
  );
  expect(screen.getByText('Positions')).toBeTruthy();
  expect(screen.getByText('MS')).toBeTruthy();
  expect(screen.getByText('FA')).toBeTruthy();
});

test('dots reflect each backend independently', () => {
  render(
    <BackendProvider>
      <WithHealth h={{ marketstore: 'up', fatechan: 'down' }} />
    </BackendProvider>,
  );
  expect(screen.getByTestId('dot-ms').style.background).toBe('rgb(76, 175, 80)');
  expect(screen.getByTestId('dot-fa').style.background).toBe('rgb(244, 67, 54)');
});

test('the pill is disabled without a handler and a refresh button appears only with one', () => {
  render(
    <BackendProvider>
      <AppHeader title="X" onMenuPress={() => {}} />
    </BackendProvider>,
  );
  expect((screen.getByTestId('health-pill') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByTestId('refresh')).toBeNull();
});
