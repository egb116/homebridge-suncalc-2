// src/platform.js

'use strict';

// Import the accessory logic to be instantiated for each configured location
const { SuncalcAccessory } = require('./accessory');

// Constants used for identifying the plugin and platform in Homebridge
const PLUGIN_NAME = 'homebridge-suncalc-2';
const PLATFORM_NAME = 'Suncalc2Platform';

/**
 * Suncalc2Platform
 * This class is the main entry point for the Homebridge platform plugin.
 * It manages the discovery, registration, and lifecycle of solar accessories.
 */
class Suncalc2Platform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config || {};

    /** * A map to track current accessories, keyed by their unique Homebridge UUID.
     * Map<UUID, PlatformAccessory> 
     */
    this.platformAccessories = new Map();

    // Event listener: Triggered when Homebridge is shutting down to allow for cleanup
    this.api.on('shutdown', () => this._shutdown());

    // Event listener: Triggered after Homebridge has finished loading its cache.
    // This is the safest time to reconcile the config vs. the cached accessories.
    this.api.on('didFinishLaunching', async() => {
      this.log.debug('didFinishLaunching');
      try {
        await this._reconcileAccessories();
      } catch (err) {
        this.log.error('Error during platform launch:', err);
      }
    });
  }

  /**
   * REQUIRED BY HOMEBRIDGE: configureAccessory
   * This method is called by Homebridge for every accessory it finds in its cache 
   * (from previous runs). We store them in our Map so we can update or remove them later.
   */
  configureAccessory(accessory) {
    this.log.info(
      `Restoring accessory from cache: ${accessory.displayName} (${accessory.UUID})`
    );
    this.platformAccessories.set(accessory.UUID, accessory);
  }

  /**
   * _reconcileAccessories
   * Compares the user's config.json against the cached accessories.
   * 1. Creates new accessories if added to config.
   * 2. Updates existing accessories if settings changed.
   * 3. Removes accessories if they were deleted from config.
   */
  async _reconcileAccessories() {
    // Support both a single object config or an 'instances' array for multiple locations
    const configs = Array.isArray(this.config.instances) ?
      this.config.instances :
      [this.config];

    // Track which UUIDs are still valid so we can delete the ones that aren't
    const keepUuids = new Set();

    for (const [index, instanceConfig] of configs.entries()) {
      // 1. Identify the instance name (defaulting to Suncalc-1, Suncalc-2, etc.)
      const baseName = instanceConfig.name ?? `Suncalc-${index + 1}`;

      // 2. Generate a stable, unique UUID based on the plugin and instance name.
      // This ensures the same configuration always maps to the same HomeKit accessory.
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${baseName}`);
      keepUuids.add(uuid);

      let accessory = this.platformAccessories.get(uuid);

      if (accessory) {
        // CASE: Accessory already exists in cache
        this.log.info(`Using cached accessory: ${baseName}`);
        
        // Update the context property in case coordinates or offsets were modified
        accessory.context.config = instanceConfig;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        // CASE: New accessory found in config that isn't in cache
        this.log.info(`Creating new accessory: ${baseName}`);
        
        const accessoryName = `${baseName}`;
        accessory = new this.api.platformAccessory(accessoryName, uuid);

        // Store configuration in context for persistence
        accessory.context.config = instanceConfig;
        this.platformAccessories.set(uuid, accessory);

        try {
          // Register the new accessory with Homebridge
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        } catch (err) {
          // Handle edge cases where the accessory might already be known to the bridge
          if (err.message.includes('already bridged')) {
            this.log.info(`Accessory already bridged, skipping registration...`);
          } else {
            this.log.error(`Error during accessory registration: ${err.message}`);
          }
        }
      }

      // 3. Attach functional logic
      // Link the physical accessory representation to the SuncalcAccessory class logic.
      if (!accessory._instance) {
        accessory._instance = new SuncalcAccessory(
          this.log,
          instanceConfig,
          this.api,
          accessory
        );
      }
    }

    // 4. Cleanup
    // Loop through cached accessories; if their UUID isn't in 'keepUuids', the user 
    // removed them from config.json, so we remove them from HomeKit.
    for (const [uuid, accessory] of this.platformAccessories.entries()) {
      if (!keepUuids.has(uuid)) {
        this.log.info(`Removing obsolete accessory: ${accessory.displayName}`);
        try {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.platformAccessories.delete(uuid);
        } catch (err) {
          if (err.message.includes('Cannot find')) {
            this.log.info(`Accessory already unbridged, skipping unregistration...`);
          } else {
            this.log.error(`Error removing accessory ${accessory.displayName}: ${err.message}`);
          }
        }
      }
    }
  }

  /**
   * _shutdown
   * Gracefully stop all active timers or intervals in the individual accessories
   * when Homebridge process is terminated.
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