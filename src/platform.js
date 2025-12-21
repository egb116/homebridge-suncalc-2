// src/platform.js

'use strict';

const { SuncalcAccessory } = require('./accessory');

const PLUGIN_NAME = 'homebridge-suncalc-2';
const PLATFORM_NAME = 'Suncalc2Platform';

class Suncalc2Platform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config || {};

    /** Map<UUID, PlatformAccessory> */
    this.platformAccessories = new Map();

    // Called when Homebridge is shutting down
    this.api.on('shutdown', () => this._shutdown());

    // Called after cached accessories are restored
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
   * Called for each cached accessory restored by Homebridge
   */
  configureAccessory(accessory) {
    this.log.info(
      `Restoring accessory from cache: ${accessory.displayName} (${accessory.UUID})`
    );
    this.platformAccessories.set(accessory.UUID, accessory);
  }

  /**
   * Reconcile config vs cache: create new, update existing, or remove obsolete
   */
  async _reconcileAccessories() {
    // Support both a single top-level config or an 'instances' array
    const configs = Array.isArray(this.config.instances) ?
      this.config.instances :
      [this.config];

    const keepUuids = new Set();

    for (const [index, instanceConfig] of configs.entries()) {
      // 1. Identify the instance
      const baseName = instanceConfig.name ?? `Suncalc-${index + 1}`;

      // 2. Generate a stable UUID based on the instance name
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${baseName}`);
      keepUuids.add(uuid);

      let accessory = this.platformAccessories.get(uuid);

      if (accessory) {
        this.log.info(`Using cached accessory: ${baseName}`);
        // Update context in case lat/lon or offsets changed in config.json
        accessory.context.config = instanceConfig;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info(`Creating new accessory: ${baseName}`);
        // "Accessory" is the bridge name; individual sensors are "Services" inside it
        // const accessoryName = `${baseName} Accessory`;
        const accessoryName = `${baseName}`;
        accessory = new this.api.platformAccessory(accessoryName, uuid);

        accessory.context.config = instanceConfig;
        this.platformAccessories.set(uuid, accessory);

        try {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        } catch (err) {
          if (err.message.includes('already bridged')) {
            this.log.info(`Accessory already bridged, skipping registration...`);
            this.log.debug(err.message);
          } else {
            this.log.error(`Error during accessory registration:`);
            this.log.error(err.message);
          }
        }
      }

      // 3. Attach or re-attach the functional logic
      if (!accessory._instance) {
        accessory._instance = new SuncalcAccessory(
          this.log,
          instanceConfig,
          this.api,
          accessory
        );
      }
    }

    // 4. Remove any accessories that exist in cache but are no longer in config.json
    for (const [uuid, accessory] of this.platformAccessories.entries()) {
      if (!keepUuids.has(uuid)) {
        this.log.info(`Removing obsolete accessory: ${accessory.displayName}`);
        try {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.platformAccessories.delete(uuid);
        } catch (err) {
          if (err.message.includes('Cannot find')) {
            this.log.info(`Accessory already unbridged, skipping unregistration...`);
            this.log.debug(err.message);
          } else {
            this.log.error(`Error removing accessory: ${accessory.displayName}`);
            this.log.error(err.message);
          }
        }
      }
    }
  }

  /**
   * Cleanup on shutdown
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