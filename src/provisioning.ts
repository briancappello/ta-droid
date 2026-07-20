export type ProvisioningAction = 'skip' | 'provision';

export function provisioningAction(
  shippedFingerprint: string,
  storedFingerprint: string | null,
): ProvisioningAction {
  if (storedFingerprint == null || storedFingerprint !== shippedFingerprint) {
    return 'provision';
  }
  return 'skip';
}

export type EncryptedBlob = {
  salt: string;
  nonce: string;
  ciphertext: string;
  fingerprint: string;
};

export type ProvisionedCred = {
  broker: string;
  id: string;
  key: string;
  secret: string;
};

export type ProvisioningDeps = {
  decrypt: (blob: EncryptedBlob, passphrase: string) => Promise<ProvisionedCred[]>;
  saveCred: (serviceKey: string, key: string, secret: string) => Promise<void>;
  saveFingerprint: (fp: string) => Promise<void>;
};

export async function runProvisioning(
  blob: EncryptedBlob,
  passphrase: string,
  deps: ProvisioningDeps,
): Promise<{ ok: true } | { ok: false; reason: 'bad-passphrase' }> {
  let creds: ProvisionedCred[];
  try {
    creds = await deps.decrypt(blob, passphrase);
  } catch {
    // decryption failure = wrong passphrase (authenticated cipher throws).
    // ponytail: log nothing — never leak passphrase/creds.
    return { ok: false, reason: 'bad-passphrase' };
  }
  for (const c of creds) {
    await deps.saveCred(`${c.broker}:${c.id}`, c.key, c.secret);
  }
  await deps.saveFingerprint(blob.fingerprint);
  return { ok: true };
}
