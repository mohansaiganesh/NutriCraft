// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Allow Drizzle to bundle generated .sql migration files.
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
