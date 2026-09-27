// Ported from __tests__/settingsScreen.test.tsx, accountsScreen.test.tsx, and
// accountPicker.test.tsx, plus the Backend profile picker.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { AccountView } from '../bindings/AccountView';
import { AccountPicker } from '../components/AccountPicker';
import { mockBackend } from '../test/backend';
import { renderAt } from '../test/render';
import { AccountsScreen } from './AccountsScreen';
import { BackendScreen } from './BackendScreen';
import { SettingsScreen } from './SettingsScreen';

const paper: AccountView = { id: 'PA123456', name: 'Paper', broker: 'alpaca', is_paper: true, key_last4: '1234' };
const live: AccountView = { id: 'LIVE9999', name: 'Live', broker: 'alpaca', is_paper: false, key_last4: '5678' };
const profiles = [
  { name: 'local', marketstore_url: 'http://127.0.0.1:5993', fatechan_url: 'http://127.0.0.1:8000', has_auth: false, has_custom_ca: false },
  { name: 'remote', marketstore_url: 'https://ms.example', fatechan_url: 'https://fa.example', has_auth: true, has_custom_ca: true },
];

test('settings shows the account count and the active profile', async () => {
  mockBackend({
    list_accounts: () => ({ accounts: [paper, live], active_id: 'PA123456' }),
    list_profiles: () => ({ profiles, active: 'local' }),
  });
  const { router } = await renderAt('/settings', [{ path: '/settings', element: <SettingsScreen /> }]);
  expect(screen.getByTestId('to-accounts').textContent).toContain('2 linked');
  expect(screen.getByTestId('to-backend').textContent).toContain('local');
  fireEvent.click(screen.getByTestId('to-accounts'));
  expect(router.state.location.pathname).toBe('/settings/accounts');
});

test('accounts show name, paper badge, id and last four; no add or edit', async () => {
  mockBackend({ list_accounts: () => ({ accounts: [paper], active_id: 'PA123456' }) });
  await renderAt('/a', [{ path: '/a', element: <AccountsScreen /> }]);
  const row = screen.getByTestId('account-PA123456');
  expect(row.textContent).toContain('Paper');
  expect(row.textContent).toContain('paper');
  expect(row.textContent).toContain('PA123456 · ••••1234');
  expect(screen.queryByText('Save')).toBeNull();
  expect(screen.queryByText('＋')).toBeNull();
});

test('a live account has no paper badge', async () => {
  mockBackend({ list_accounts: () => ({ accounts: [live], active_id: 'LIVE9999' }) });
  await renderAt('/a', [{ path: '/a', element: <AccountsScreen /> }]);
  expect(screen.getByTestId('account-LIVE9999').textContent).not.toContain('paper');
});

test('accounts empty state', async () => {
  mockBackend();
  await renderAt('/a', [{ path: '/a', element: <AccountsScreen /> }]);
  expect(screen.getByText('No accounts provisioned. Configure ACCOUNTS_JSON and provision credentials.')).toBeTruthy();
});

test('picker shows the selected account with the paper suffix', () => {
  render(<AccountPicker accounts={[paper, live]} selectedId="PA123456" onSelect={() => {}} />);
  expect(screen.getByTestId('account-picker').textContent).toBe('Paper · PAPER ▼');
});

test('picker: live account has no suffix, and nothing selected shows the placeholder', () => {
  const { rerender } = render(<AccountPicker accounts={[paper, live]} selectedId="LIVE9999" onSelect={() => {}} />);
  expect(screen.getByTestId('account-picker').textContent).toBe('Live ▼');
  rerender(<AccountPicker accounts={[paper, live]} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByTestId('account-picker').textContent).toBe('Select account ▼');
});

test('picker: choosing closes the menu; tapping outside closes it too', () => {
  const onSelect = vi.fn();
  render(<AccountPicker accounts={[paper, live]} selectedId="PA123456" onSelect={onSelect} />);
  fireEvent.click(screen.getByTestId('account-picker'));
  expect(screen.getByTestId('account-option-PA123456').getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByTestId('account-option-LIVE9999'));
  expect(onSelect).toHaveBeenCalledWith('LIVE9999');
  expect(screen.queryByTestId('account-menu')).toBeNull();
  fireEvent.click(screen.getByTestId('account-picker'));
  fireEvent.click(screen.getByTestId('account-menu-overlay'));
  expect(screen.queryByTestId('account-menu')).toBeNull();
});

test('backend lists profiles, shows auth without values, and switches', async () => {
  let active = 'local';
  const calls = mockBackend({
    list_profiles: () => ({ profiles, active }),
    set_active_profile: ({ name }) => {
      active = name as string;
      return { profiles, active };
    },
  });
  await renderAt('/b', [{ path: '/b', element: <BackendScreen /> }]);
  expect(screen.getByTestId('profile-local').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('profile-remote-flags').textContent).toBe('auth · custom CA');
  expect(screen.getByTestId('profile-remote').textContent).toContain('https://ms.example');
  await act(async () => {
    fireEvent.click(screen.getByTestId('profile-remote'));
  });
  expect(calls.find(c => c.cmd === 'set_active_profile')?.args).toEqual({ name: 'remote' });
  expect(screen.getByTestId('profile-remote').getAttribute('aria-pressed')).toBe('true');
  // Health re-probes after a switch.
  expect(calls.filter(c => c.cmd === 'health').length).toBeGreaterThan(0);
});
