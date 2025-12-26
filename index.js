// index.js

'use strict';

/**
 * Import the main Platform class.
 * This class handles the discovery and management of accessories.
 */
const Suncalc2Platform = require('./src/platform');

/**
 * Homebridge entry point.
 * This function is called by Homebridge to initialize the plugin.
 * * @param {Object} api - The Homebridge API providing access to HAP,
 * platform registration, and system events.
 */
module.exports = api => {
  /**
   * registerPlatform
   * Maps the plugin identifier and the platform name (from config.json)
   * to the Suncalc2Platform class logic.
   * * @param {string} pluginName - The name of the NPM package (must match package.json).
   * @param {string} platformName - The 'platform' identifier used in the Homebridge config.
   * @param {constructor} Suncalc2Platform - The class constructor to instantiate.
   */
  api.registerPlatform('homebridge-suncalc-2', 'Suncalc2Platform', Suncalc2Platform);
};