/* eslint no-param-reassign: "off" */
const { aliasWebpack } = require('react-app-alias-ex');
const rootConfig = require('./src/config/default');

module.exports = function override(config) {
  config.externals = {
    config: JSON.stringify(rootConfig),
    '@polygon-nightfall/common-files/utils/logger.mjs': JSON.stringify({}), // mock logger in cli/nf3.mjs
    ws: JSON.stringify({}), // mock ws in cli/nf3.mjs
    'node-cron': JSON.stringify({}), // mock node-cron in cli/nf3.mjs
    crypto: JSON.stringify({}), // mock crypto in cli/nf3.mjs
  };

  // Completely remove source-map-loader to avoid broken source map warnings
  config.module.rules = config.module.rules
    .map(rule => {
      // Filter out source-map-loader from direct rules
      if (rule.loader && rule.loader.includes('source-map-loader')) {
        return null;
      }

      // Filter out source-map-loader from nested oneOf rules
      if (rule.oneOf) {
        return {
          ...rule,
          oneOf: rule.oneOf.filter(
            oneOfRule => !oneOfRule.loader || !oneOfRule.loader.includes('source-map-loader'),
          ),
        };
      }

      return rule;
    })
    .filter(Boolean); // Remove null entries

  // Also suppress any remaining source map warnings
  config.ignoreWarnings = [/Failed to parse source map/, /source-map-loader/];

  return aliasWebpack({})(config);
};
