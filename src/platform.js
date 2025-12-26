// src/platform.js

'use strict';

/**
 * Import the accessory logic. 
 * This class handles the actual solar calculations and HomeKit services for a specific location.
 */
const { SuncalcAccessory } = require('./accessory');

/**
 * Plugin Constants
 * These must match the 'pluginName' and 'platform' values defined in the package.json.
 */
const PLUGIN_NAME = 'homebridge-suncalc-2';
const PLATFORM_NAME = 'Suncalc2Platform';

/**
 * Suncalc2Platform
 * Main entry point for the Homebridge platform plugin.
 * Handles the discovery, registration, and persistent lifecycle of solar accessories.
 */
class Suncalc2Platform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config || {};

    /** * Accessory Cache
     * A map to track current accessories, keyed by their unique Homebridge UUID.
     * @type {Map<string, PlatformAccessory>} 
     */
    this.platformAccessories = new Map();

    /**
     * Lifecycle Event: Shutdown
     * Triggered when Homebridge is stopping. Ensures we kill active timers to prevent memory leaks.
     */
    this.api.on('shutdown', () => this._shutdown());

    /**
     * Lifecycle Event: Finished Launching
     * Triggered after Homebridge restores cached accessories. 
     * This is the standard point to reconcile user config with the physical accessory state.
     */
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('didFinishLaunching event occurred');
      try {
        await this._reconcileAccessories();
      } catch (err) {
        this.log.error('Error during platform launch:', err);
      }
    });
  }

  /**
   * REQUIRED BY HOMEBRIDGE: configureAccessory
   * Invoked by Homebridge for every accessory found in its persistent cache (disk).
   * We store these in our Map so we can update them or prune them later.
   * @param {PlatformAccessory} accessory
   */
  configureAccessory(accessory) {
    this.log.info(
      `Restoring accessory from cache: ${accessory.displayName} (${accessory.UUID})`
    );
    this.platformAccessories.set(accessory.UUID, accessory);
  }

  /**
   * Internal Method: reconcileAccessories
   * Syncs the user's config.json with the HomeKit bridge.
   * 1. Creates new accessories for new config entries.
   * 2. Re-initializes existing accessories with updated settings.
   * 3. Unregisters accessories that were removed from the config.
   */
  async _reconcileAccessories() {
    // Standardize config: Support a single object config OR the 'instances' array pattern.
    const configs = Array.isArray(this.config.instances) ?
      this.config.instances :
      [this.config];

    // Used to track which cached accessories should survive this run
    const keepUuids = new Set();

    for (const [index, instanceConfig] of configs.entries()) {
      // 1. Identify the instance name (defaults to Suncalc-1, Suncalc-2, etc.)
      const baseName = instanceConfig.name ?? `Suncalc-${index + 1}`;

      // 2. Generate a stable, deterministic UUID. 
      // This links the name in config.json to the same HomeKit ID every time.
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${baseName}`);
      keepUuids.add(uuid);

      let accessory = this.platformAccessories.get(uuid);

      if (accessory) {
        /**
         * SCENARIO: Accessory is already in the cache.
         */
        this.log.info(`Using cached accessory: ${baseName}`);
        
        // If an instance exists (e.g. from a hot reload), clean up its timers first.
        if (accessory._instance) {
          this.log.debug(`[${baseName}] Cleaning up old instance for re-initialization`);
          accessory._instance.cleanup();
          accessory._instance = null;
        }

        // Pass the latest config into the accessory context for persistence.
        accessory.context.config = instanceConfig;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        /**
         * SCENARIO: New accessory found in config (not in cache).
         */
        this.log.info(`Creating new accessory: ${baseName}`);
        
        const accessoryName = `${baseName}`;
        accessory = new this.api.platformAccessory(accessoryName, uuid);

        // Save config to context so it survives a Homebridge restart.
        accessory.context.config = instanceConfig;
        this.platformAccessories.set(uuid, accessory);

        try {
          // Officially register the new accessory with the HomeKit bridge.
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        } catch (err) {
          // Guard against "Already Bridged" errors if cache and bridge fall out of sync.
          if (err.message.includes('already bridged')) {
            this.log.debug(`Accessory already bridged, skipping registration step`);
          } else {
            this.log.error(`Error during accessory registration: ${err.message}`);
          }
        }
      }

      /**
       * Link Functional Logic
       * Instantiate the SuncalcAccessory class, which handles the solar logic/updating.
       * We store this on the accessory object as `_instance`.
       */
      if (!accessory._instance) {
        accessory._instance = new SuncalcAccessory(
          this.log,
          instanceConfig,
          this.api,
          accessory
        );
      }
    }

    /**
     * Final Pruning
     * Remove any accessories that exist in the Homebridge cache but are no longer 
     * present in the user's config.json.
     */
    for (const [uuid, accessory] of this.platformAccessories.entries()) {
      if (!keepUuids.has(uuid)) {
        this.log.info(`Removing obsolete accessory: ${accessory.displayName}`);
        try {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.platformAccessories.delete(uuid);
        } catch (err) {
          if (err.message.includes('Cannot find')) {
            this.log.debug(`Accessory already unbridged, skipping unregistration step`);
          } else {
            this.log.error(`Error removing accessory ${accessory.displayName}: ${err.message}`);
          }
        }
      }
    }
  }

  /**
   * Internal Method: shutdown
   * Gracefully stops all active solar calculation timers when Homebridge closes.
   */
  _shutdown() {
    for (const accessory of this.platformAccessories.values()) {
      if (accessory._instance?.cleanup) {
        accessory._instance.cleanup();
      }
    }
  }
}

module.exports = Suncalc2Platform;