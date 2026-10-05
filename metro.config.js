const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// The bundled nutrition corpus is a binary SQLite asset, not source — without
// this Metro won't resolve `require('./assets/nutrition.db')`.
config.resolver.assetExts = [...config.resolver.assetExts, 'db']

module.exports = config
