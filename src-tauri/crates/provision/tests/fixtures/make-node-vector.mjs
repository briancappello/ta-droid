import { writeFileSync } from 'node:fs';
import { encryptCredentials } from '../../../../../scripts/encrypt-credentials.mjs';
// Regenerate: node src-tauri/crates/provision/tests/fixtures/make-node-vector.mjs
// Cross-implementation vector: the Node/libsodium encryptor that the Rust
// provision crate must stay compatible with. Dummy values only.
const out = new URL('.', import.meta.url).pathname;
const passphrase = 'test-vector passphrase (not a secret)';
const plaintext = {
  credentials: [
    { broker: 'alpaca', id: 'PA1TEST', key: 'PKTESTKEY0000001', secret: 'test-secret-0001' },
    { broker: 'alpaca', id: 'LV1TEST', key: 'AKTESTKEY0000002', secret: 'test-secret-0002' },
  ],
  backends: {
    remote: { 'CF-Access-Client-Id': 'test-client-id', 'CF-Access-Client-Secret': 'test-client-secret' },
  },
};
const blob = await encryptCredentials(passphrase, plaintext);
writeFileSync(`${out}/node-blob.json`, JSON.stringify(blob, null, 2) + '\n');
writeFileSync(`${out}/node-plaintext.json`, JSON.stringify(plaintext, null, 2) + '\n');
writeFileSync(`${out}/node-passphrase.txt`, passphrase + '\n');
