// The provisioning gate (credential-provisioning spec; RN App.tsx gate).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AccountProvider } from '../state/accounts';
import { mockBackend } from '../test/backend';
import { ProvisioningGate } from './ProvisioningGate';

async function renderGate() {
  render(
    <AccountProvider>
      <ProvisioningGate>
        <p data-testid="inside">app</p>
      </ProvisioningGate>
    </AccountProvider>,
  );
  await act(async () => {});
}

async function submit(pass: string) {
  fireEvent.change(screen.getByTestId('passphrase'), { target: { value: pass } });
  await act(async () => {
    fireEvent.submit(screen.getByTestId('provisioning'));
  });
}

test('no blob or same fingerprint: the app shows without a prompt', async () => {
  mockBackend({ provisioning_status: () => ({ needed: false }) });
  await renderGate();
  expect(screen.getByTestId('inside')).toBeTruthy();
});

test('a wrong passphrase clears the field and says so', async () => {
  const calls = mockBackend({ provisioning_status: () => ({ needed: true }), provision: () => ({ outcome: 'bad-passphrase' }) });
  await renderGate();
  expect(screen.getByText('Enter provisioning passphrase')).toBeTruthy();
  await submit('wrong');
  expect(screen.getByTestId('provisioning-error').textContent).toBe('Incorrect passphrase.');
  expect((screen.getByTestId('passphrase') as HTMLInputElement).value).toBe('');
  expect(screen.queryByTestId('inside')).toBeNull();
  expect(calls.find(c => c.cmd === 'provision')?.args).toEqual({ passphrase: 'wrong' });
});

test('a storage failure has its own message', async () => {
  mockBackend({ provisioning_status: () => ({ needed: true }), provision: () => ({ outcome: 'save-failed' }) });
  await renderGate();
  await submit('right');
  expect(screen.getByTestId('provisioning-error').textContent).toBe('Could not save credentials to secure storage.');
});

test('success loads accounts and opens the app; there is no lockout', async () => {
  let tries = 0;
  const calls = mockBackend({
    provisioning_status: () => ({ needed: true }),
    provision: () => (++tries < 4 ? { outcome: 'bad-passphrase' } : { outcome: 'ok' }),
  });
  await renderGate();
  for (let i = 0; i < 3; i++) await submit('wrong');
  await submit('right');
  expect(screen.getByTestId('inside')).toBeTruthy();
  expect(calls.filter(c => c.cmd === 'list_accounts').length).toBe(1);
});

test('the button shows a busy state and ignores a second submit while deriving', async () => {
  let release!: (v: unknown) => void;
  const calls = mockBackend({
    provisioning_status: () => ({ needed: true }),
    provision: () => new Promise(r => (release = r)),
  });
  await renderGate();
  fireEvent.change(screen.getByTestId('passphrase'), { target: { value: 'p' } });
  await act(async () => {
    fireEvent.submit(screen.getByTestId('provisioning'));
  });
  expect(screen.getByTestId('unlock').textContent).toBe('Unlocking…');
  expect((screen.getByTestId('unlock') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    fireEvent.submit(screen.getByTestId('provisioning'));
  });
  expect(calls.filter(c => c.cmd === 'provision').length).toBe(1);
  await act(async () => release({ outcome: 'ok' }));
  expect(screen.getByTestId('inside')).toBeTruthy();
});
