const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // ponytail: reanimated v4's package.json points its `react-native`/`source`
    // field at uncompiled `src/index.ts`, which Metro can't fully resolve under
    // RN 0.84. Redirect the package entry to its compiled `lib/module` output.
    // Remove if a future reanimated ships a Metro-resolvable src or an exports map.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-reanimated') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            __dirname,
            'node_modules/react-native-reanimated/lib/module/index.js',
          ),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
