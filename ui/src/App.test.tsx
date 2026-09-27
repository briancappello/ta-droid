// Ported from __tests__/App.test.tsx, plus the drawer and stacks.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';
import { mockBackend } from './test/backend';

async function renderApp(path?: string) {
  render(<App initialPath={path} />);
  await act(async () => {});
}

test('renders and opens on Watchlists', async () => {
  mockBackend();
  await renderApp();
  expect(screen.getByTestId('app-root')).toBeTruthy();
  expect(screen.getByTestId('screen-watchlists')).toBeTruthy();
});

test('the drawer lists the five destinations and navigates', async () => {
  mockBackend();
  await renderApp();
  fireEvent.click(screen.getByTestId('menu'));
  const items = screen.getByTestId('drawer').querySelectorAll('button');
  expect(Array.from(items).map(b => b.textContent)).toEqual(['Chart', 'Positions', 'Orders', 'Watchlists', 'Settings']);
  fireEvent.click(screen.getByTestId('nav-positions'));
  expect(screen.getByTestId('screen-positions')).toBeTruthy();
  expect(screen.queryByTestId('drawer')).toBeNull();
});

test('the scrim closes the drawer', async () => {
  mockBackend();
  await renderApp();
  fireEvent.click(screen.getByTestId('menu'));
  fireEvent.click(screen.getByTestId('drawer-scrim'));
  expect(screen.queryByTestId('drawer')).toBeNull();
});

test('chart opens on AMD and its stack goes back through history', async () => {
  mockBackend();
  await renderApp('/chart');
  expect(screen.getByTestId('screen-chart').textContent).toContain('AMD');
  fireEvent.click(screen.getByTestId('to-order'));
  expect(screen.getByTestId('screen-order')).toBeTruthy();
  fireEvent.click(screen.getByTestId('back'));
  expect(screen.getByTestId('screen-chart')).toBeTruthy();
});

test('the health pill opens Backend settings', async () => {
  mockBackend();
  await renderApp();
  fireEvent.click(screen.getByTestId('health-pill'));
  expect(screen.getByTestId('screen-backend')).toBeTruthy();
});

test('the gate hides the app until provisioned', async () => {
  mockBackend({ provisioning_status: () => ({ needed: true }) });
  await renderApp();
  expect(screen.getByTestId('provisioning')).toBeTruthy();
  expect(screen.queryByTestId('screen-watchlists')).toBeNull();
});
