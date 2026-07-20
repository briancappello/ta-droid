// src/secretsBackend.ts
import * as Keychain from 'react-native-keychain';
import {
  ready, crypto_pwhash, crypto_secretbox_open_easy, from_base64, to_string,
  base64_variants, crypto_secretbox_KEYBYTES,
  crypto_pwhash_OPSLIMIT_MODERATE, crypto_pwhash_MEMLIMIT_MODERATE,
  crypto_pwhash_ALG_ARGON2ID13,
} from 'react-native-libsodium';
import type { EncryptedBlob, ProvisionedCred, ProvisioningDeps } from './provisioning';

const FINGERPRINT_SERVICE = 'creds.fingerprint';
const credService = (serviceKey: string) => `cred.${serviceKey}`;

async function decrypt(blob: EncryptedBlob, passphrase: string): Promise<ProvisionedCred[]> {
  await ready;
  const V = base64_variants.ORIGINAL;
  const key = crypto_pwhash(
    crypto_secretbox_KEYBYTES, passphrase, from_base64(blob.salt, V),
    crypto_pwhash_OPSLIMIT_MODERATE, crypto_pwhash_MEMLIMIT_MODERATE,
    crypto_pwhash_ALG_ARGON2ID13,
  );
  const plaintext = crypto_secretbox_open_easy(
    from_base64(blob.ciphertext, V), from_base64(blob.nonce, V), key,
  ); // throws on wrong passphrase
  return JSON.parse(to_string(plaintext)) as ProvisionedCred[];
}

export const secretsDeps: ProvisioningDeps = {
  decrypt,
  saveCred: async (serviceKey, key, secret) => {
    await Keychain.setGenericPassword(key, secret, { service: credService(serviceKey) });
  },
  saveFingerprint: async fp => {
    await Keychain.setGenericPassword('fp', fp, { service: FINGERPRINT_SERVICE });
  },
};

export async function readFingerprint(): Promise<string | null> {
  const e = await Keychain.getGenericPassword({ service: FINGERPRINT_SERVICE });
  return e ? e.password : null;
}

export async function readCred(serviceKey: string): Promise<{ key: string; secret: string } | null> {
  const e = await Keychain.getGenericPassword({ service: credService(serviceKey) });
  return e ? { key: e.username, secret: e.password } : null;
}
