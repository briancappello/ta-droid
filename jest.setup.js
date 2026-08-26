/* eslint-env jest */
import 'react-native-gesture-handler/jestSetup';

// react-native-worklets touches native modules at import time (pulled in by
// react-native-reanimated). Replace it with a deep no-op Proxy so any export
// — whether called as a function or used as an object with methods — resolves
// to a harmless no-op and the reanimated mock can load under Node.
jest.mock('react-native-worklets', () => {
  const makeNoop = () =>
    new Proxy(function () {}, {
      get: (_target, prop) => {
        if (prop === '__esModule') {
          return true;
        }
        return makeNoop();
      },
      apply: () => undefined,
    });
  return makeNoop();
});

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// react-native-config reads a native module that is absent under Node.
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'https://example.test',
    MARKETSTORE_BASE_URL: 'https://ms.test',
    ACCOUNTS_JSON: '[]',
    // CREDENTIALS_BLOB_JSON left undefined → provisioning gate resolves 'ready'
  },
}));

// react-native-libsodium binds a native module; mock the crypto surface used by
// secretsBackend. secretbox_open_easy is the wrong-passphrase throw point.
jest.mock('react-native-libsodium', () => ({
  __esModule: true,
  ready: Promise.resolve(),
  crypto_pwhash: jest.fn(() => new Uint8Array(32)),
  crypto_secretbox_open_easy: jest.fn(() => new Uint8Array()),
  from_base64: jest.fn(() => new Uint8Array()),
  to_string: jest.fn(() => '[]'),
  base64_variants: { ORIGINAL: 1 },
  crypto_secretbox_KEYBYTES: 32,
  crypto_pwhash_SALTBYTES: 16,
  crypto_secretbox_NONCEBYTES: 24,
  crypto_pwhash_OPSLIMIT_MODERATE: 3,
  crypto_pwhash_MEMLIMIT_MODERATE: 268435456,
  crypto_pwhash_ALG_ARGON2ID13: 2,
}));

// react-native-webview binds a native TurboModule at import; stub the view.
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { __esModule: true, WebView: View, default: View };
});
