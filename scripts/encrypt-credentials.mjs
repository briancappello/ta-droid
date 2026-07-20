// scripts/encrypt-credentials.mjs
import sodium from 'libsodium-wrappers-sumo';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const V_ORIGINAL = () => sodium.base64_variants.ORIGINAL;

export async function encryptCredentials(passphrase, credsArray) {
  await sodium.ready;
  const V = V_ORIGINAL();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const plaintext = sodium.from_string(JSON.stringify(credsArray));
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const ciphertextB64 = sodium.to_base64(ciphertext, V);
  const fingerprint = createHash('sha256').update(ciphertextB64).digest('hex');
  return {
    salt: sodium.to_base64(salt, V),
    nonce: sodium.to_base64(nonce, V),
    ciphertext: ciphertextB64,
    fingerprint,
  };
}

// CLI: node scripts/encrypt-credentials.mjs <passphrase> [inPath] [outPath]
// Reads plaintext creds JSON array from inPath (default credentials.local.json),
// writes the blob JSON to outPath (default android/app/src/main/assets/credentials.enc.json
// — a path the build injects; final path settled in C3), and prints the
// ready-to-paste `CREDENTIALS_BLOB_JSON=...` line for the operator's `.env`.
// ponytail: async IIFE (not top-level await) so babel-jest's CJS transform of
// this .mjs doesn't reject it; the CLI guard is never run under jest anyway.
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const [, , passphrase, inPath = 'credentials.local.json', outPath = 'credentials.enc.json'] = process.argv;
    if (!passphrase) {
      console.error('usage: node scripts/encrypt-credentials.mjs <passphrase> [in] [out]');
      process.exit(1);
    }
    const creds = JSON.parse(readFileSync(inPath, 'utf8'));
    const blob = await encryptCredentials(passphrase, creds);
    writeFileSync(outPath, JSON.stringify(blob, null, 2));
    // ponytail: never log the passphrase or plaintext creds.
    console.log(`wrote ${outPath} (fingerprint ${blob.fingerprint.slice(0, 12)}…)`);
    console.log(`CREDENTIALS_BLOB_JSON=${JSON.stringify(blob)}`);
  })();
}
