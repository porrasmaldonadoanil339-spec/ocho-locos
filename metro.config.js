const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const defaultBlockList = config.resolver.blockList || [];
const blockListArray = Array.isArray(defaultBlockList)
  ? defaultBlockList
  : [defaultBlockList];

config.resolver.blockList = [
  ...blockListArray,
  /\.local[/\\]state[/\\].*/,
];

module.exports = config;
