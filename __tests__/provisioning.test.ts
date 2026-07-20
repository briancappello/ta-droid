import { provisioningAction, runProvisioning, type EncryptedBlob } from '../src/provisioning';

const blob: EncryptedBlob = { salt: 's', nonce: 'n', ciphertext: 'c', fingerprint: 'fp-new' };

test('provisioningAction: fresh install provisions', () => {
  expect(provisioningAction('fp-new', null)).toBe('provision');
});
test('provisioningAction: changed fingerprint provisions', () => {
  expect(provisioningAction('fp-new', 'fp-old')).toBe('provision');
});
test('provisioningAction: unchanged skips', () => {
  expect(provisioningAction('fp-new', 'fp-new')).toBe('skip');
});

test('runProvisioning decrypts, saves creds keyed broker:id, stores fingerprint', async () => {
  const saved: Record<string, { key: string; secret: string }> = {};
  let savedFp: string | null = null;
  const res = await runProvisioning(blob, 'pass', {
    decrypt: async () => [{ broker: 'alpaca', id: 'PA1', key: 'K', secret: 'S' }],
    saveCred: async (k, key, secret) => { saved[k] = { key, secret }; },
    saveFingerprint: async fp => { savedFp = fp; },
  });
  expect(res).toEqual({ ok: true });
  expect(saved['alpaca:PA1']).toEqual({ key: 'K', secret: 'S' });
  expect(savedFp).toBe('fp-new');
});

test('runProvisioning reports bad-passphrase when decrypt throws', async () => {
  const res = await runProvisioning(blob, 'wrong', {
    decrypt: async () => { throw new Error('auth failed'); },
    saveCred: async () => {},
    saveFingerprint: async () => {},
  });
  expect(res).toEqual({ ok: false, reason: 'bad-passphrase' });
});

test('runProvisioning returns save-failed when saveCred throws', async () => {
  let savedFp: string | null = null;
  const res = await runProvisioning(blob, 'pass', {
    decrypt: async () => [{ broker: 'alpaca', id: 'PA1', key: 'K', secret: 'S' }],
    saveCred: async () => { throw new Error('keychain write failed'); },
    saveFingerprint: async fp => { savedFp = fp; },
  });
  expect(res).toEqual({ ok: false, reason: 'save-failed' });
  expect(savedFp).toBeNull();
});
