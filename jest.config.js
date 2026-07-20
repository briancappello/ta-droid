module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  // .mjs support for build-side scripts + their tests (e.g. scripts/encrypt-credentials.mjs)
  moduleFileExtensions: ['js', 'mjs', 'json', 'jsx', 'ts', 'tsx', 'node'],
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
    '**/?(*.)+(spec|test).mjs',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-gesture-handler|react-native-reanimated|react-native-drawer-layout|react-native-worklets|react-native-config|react-native-webview|react-native-libsodium)/)',
  ],
};
