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
  default: { API_BASE_URL: 'https://example.test' },
}));

// react-native-webview binds a native TurboModule at import; stub the view.
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { __esModule: true, WebView: View, default: View };
});
