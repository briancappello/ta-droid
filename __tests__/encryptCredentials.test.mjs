// __tests__/encryptCredentials.test.mjs
import { createHash } from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';
import { encryptCredentials } from '../scripts/encrypt-credentials.mjs';

test('encryptCredentials round-trips with the same primitives', async () => {
  await sodium.ready;
  const creds = [{ broker: 'alpaca', id: 'PA1', key: 'K', secret: 'S' }];
  const blob = await encryptCredentials('correct horse battery staple', creds);
  expect(blob.salt && blob.nonce && blob.ciphertext && blob.fingerprint).toBeTruthy();
  expect(blob.fingerprint).toBe(createHash('sha256').update(blob.ciphertext).digest('hex'));

  // decrypt with the same primitives (simulating the RN side)
  const V = sodium.base64_variants.ORIGINAL;
  const salt = sodium.from_base64(blob.salt, V);
  const nonce = sodium.from_base64(blob.nonce, V);
  const ct = sodium.from_base64(blob.ciphertext, V);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES, 'correct horse battery staple', salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const pt = sodium.crypto_secretbox_open_easy(ct, nonce, key);
  expect(JSON.parse(sodium.to_string(pt))).toEqual(creds);
});

test('wrong passphrase fails to decrypt', async () => {
  await sodium.ready;
  const blob = await encryptCredentials('right', [{ broker: 'alpaca', id: 'x', key: 'K', secret: 'S' }]);
  const V = sodium.base64_variants.ORIGINAL;
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES, 'wrong', sodium.from_base64(blob.salt, V),
    sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  expect(() =>
    sodium.crypto_secretbox_open_easy(
      sodium.from_base64(blob.ciphertext, V), sodium.from_base64(blob.nonce, V), key,
    ),
  ).toThrow();
});
