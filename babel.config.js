module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-reanimated/plugin'],
  // jest transforms .mjs → CJS, which rejects import.meta in build-side scripts
  // (scripts/*.mjs CLI guards). Enable the transform only under test.
  env: {
    test: {
      plugins: ['babel-plugin-transform-import-meta'],
    },
  },
};
