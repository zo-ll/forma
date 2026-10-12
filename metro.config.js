const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;

// Exclude coordinator worktrees from the app module graph.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /(?:^|[\\/])\.filo(?:[\\/]|$)/,
];

module.exports = config;
