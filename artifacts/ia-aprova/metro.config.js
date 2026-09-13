const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.blockList = [
  /node_modules\/.pnpm\/@solana\+programs.*/,
  /node_modules\/.pnpm\/@solana.*programs_tmp.*/,
];

module.exports = config;
