// src/accessory.js

'use strict';

/**
 * Required dependency: suncalc
 * Used to calculate sun position and sunlight phases based on latitude/longitude.
 */
const suncalc = require('suncalc');

/**
 * Metadata mapping for the 14 solar phases provided by suncalc.
 * Used to generate human-readable names and descriptions for HomeKit sensors.
 */
const SUN_TIMES_META = {
  nightEnd: { name: 'Morning Twilight', description: 'Astronomical twilight starts' },
  nauticalDawn: { name: 'Nautical Dawn', description: 'Nautical twilight starts' },
  dawn: { name: 'Civil Dawn', description: 'Civil twilight starts' },
  sunrise: { name: 'First Light', description: 'Sun starts appearing' },
  sunriseEnd: { name: 'Morning Golden Hour', description: 'Sun is up, golden hour starts' },
  goldenHourEnd: { name: 'Daytime', description: 'Golden hour ends, full day starts' },
  solarNoon: { name: 'Solar Noon', description: 'Sun at highest point' },
  goldenHour: { name: 'Evening Golden Hour', description: 'Evening golden hour starts' },
  sunsetStart: { name: 'Sunset', description: 'Sun starts setting' },
  sunset: { name: 'Evening Twilight', description: 'Sun below horizon' },
  dusk: { name: 'Civil Dusk', description: 'Civil twilight ends' },
  nauticalDusk: { name: 'Nautical Dusk', description: 'Nautical twilight ends' },
  night: { name: 'Nightfall', description: 'Astronomical twilight ends' },
  nadir: { name: 'Deepest Night', description: 'Darkest part of the night' }
};

/**
 * Configuration Presets: Defines which sensors are enabled based on the user's config mode.
 */
const SENSOR_MODES = {
  basic: ['sunrise', 'sunset'],
  extended: ['sunrise', 'goldenHourEnd', 'goldenHour', 'sunset'],
  full: Object.keys(SUN_TIMES_META)
};

/**
 * Helper: Extracts the suncalc key (e.g., 'sunrise') from a HomeKit service subtype.
 * @param {string} accessoryUUID - The unique ID of the accessory.
 * @param {string} subtype - The service subtype string.
 * @returns {string|null} - Returns the key if valid, otherwise null.
 */
function getServiceKeyFromSubtype(accessoryUUID, subtype) {
  if (typeof subtype !== 'string') {
    return null;
  }

  const prefix = `${accessoryUUID}:`;
  if (!subtype.startsWith(prefix)) {
    return null;
  }

  const key = subtype.slice(prefix.length);
  return SUN_TIMES_META[key] ? key : null;
}

/**
 * Main Accessory Class for Homebridge Suncalc.
 * Creates and manages multiple Occupancy Sensors representing solar events.
 */
class SuncalcAccessory {
  constructor(log, config, api, accessory) {
    this.log = log;
    this.api = api;
    this.accessory = accessory;

    // Shortcuts to HomeKit Accessory Protocol (HAP) types
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Configuration retrieval
    this.platformName = config.name || 'Suncalc';
    this.location = config.location; // Expects { lat: number, lon: number }

    // Mode selection: Determine which sensors should be active
    this.mode = config.mode || 'full';
    this.enabledSensors = SENSOR_MODES[this.mode] || SENSOR_MODES.full;

    // Change Detection: Check if the user changed the mode since the last restart
    const previousMode = accessory.context?.mode;
    const modeChanged = !!previousMode && previousMode !== this.mode;

    this.log.debug(
      `[${this.platformName}] DEBUG: previousMode='${previousMode}', ` +
      `currentMode='${this.mode}', modeChanged=${modeChanged}`
    );

    // Update persistent context
    accessory.context.mode = this.mode;

    // Optional offsets (in minutes) to shift specific solar events
    // (useful for lighting automations)
    this.sunriseEndOffset = config.offset?.sunriseEnd || 0;
    this.sunsetStartOffset = config.offset?.sunsetStart || 0;

    // Storage for internal service/characteristic references
    this.sensors = {};

    this.log.info(
      `[${this.platformName}] Mode: ${this.mode} | ` +
      `Sensors: ${this.enabledSensors.join(', ')}`
    );

    this.setupAccessoryInfo();

    // If the mode changed, we must remove old sensors that are no longer in the active preset
    if (modeChanged) {
      this.log.info(
        `[${this.platformName}] Mode changed from ` +
        `'${previousMode}' to '${this.mode}'`
      );
      this.pruneServicesIfNeeded();
    }

    // Initialize/Restore sensors and start the calculation loop
    this.setupServices();
    this.updateSunTimes();
  }

  /**
   * Configures the standard Accessory Information service (Manufacturer, Model, Serial).
   */
  setupAccessoryInfo() {
    const manufacturer = 'Homebridge Suncalc';
    const model = 'Solar Times Sensor';
    const serialNumber = this.accessory.UUID;

    const informationService = this.accessory.getService(this.Service.AccessoryInformation);
    if (informationService) {
      informationService
        .setCharacteristic(this.Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(this.Characteristic.Model, model)
        .setCharacteristic(this.Characteristic.SerialNumber, serialNumber);
    }
  }

  /**
   * Creates or restores Occupancy Sensor services for each enabled solar event.
   */
  setupServices() {
    this.enabledSensors.forEach(key => {
      const meta = SUN_TIMES_META[key];
      const sensorName = `${this.platformName} ${meta.name}`;

      // Generate a unique, deterministic subtype to identify this specific sensor
      const serviceSubtype = `${this.accessory.UUID}:${key}`;

      // Reuse existing service from cache or create a new one
      let service = this.accessory.getServiceById(this.Service.OccupancySensor, serviceSubtype);

      if (!service) {
        service = this.accessory.addService(
          this.Service.OccupancySensor,
          sensorName,
          serviceSubtype
        );
      }

      // Sync naming
      service.getCharacteristic(this.Characteristic.Name).updateValue(sensorName);

      // Support for user-defined names in the Home App
      if (!service.testCharacteristic(this.Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
      }
      service.setCharacteristic(this.Characteristic.ConfiguredName, sensorName);

      /**
       * Custom Characteristic: 'Event Time'
       * Displays the calculated event time (e.g., '6:45 AM') as a string in the Home App.
       */
      const charUuid = this.api.hap.uuid.generate(`${serviceSubtype}:time`);
      let timeChar = service.characteristics.find(c => c.UUID === charUuid);

      if (!timeChar) {
        timeChar = service.addCharacteristic(new this.Characteristic('Event Time', charUuid));
        timeChar.setProps({
          format: this.api.hap.Formats.STRING,
          perms: [this.api.hap.Perms.PAIRED_READ, this.api.hap.Perms.NOTIFY]
        });
      }

      // Save references for periodic updates
      this.sensors[key] = { service, timeChar };
    });

    this.log.debug(
      `[${this.platformName}] DEBUG setupServices: ` +
      `Total accessory services: ${this.accessory.services.length}`
    );
  }

  /**
   * Compares currently registered services against the active mode and removes unused ones.
   */
  pruneServicesIfNeeded() {
    this.log.info(`[${this.platformName}] Mode changed → pruning unused sensors`);

    const allowedSubtypes = new Set(
      this.enabledSensors.map(key => `${this.accessory.UUID}:${key}`)
    );

    // Resolve UUID for comparison (handles variations in HAP-NodeJS versions)
    const occupancySensorUUID = this.Service.OccupancySensor.UUID || this.Service.OccupancySensor;

    const servicesToRemove = this.accessory.services.filter(service => {
      // Ignore non-occupancy sensors (like Accessory Information)
      if (service.UUID !== occupancySensorUUID) {
        return false;
      }

      // If the service's subtype is not in our 'enabled' list, mark for removal
      return !service.subtype || !allowedSubtypes.has(service.subtype);
    });

    for (const service of servicesToRemove) {
      const key = getServiceKeyFromSubtype(this.accessory.UUID, service.subtype);
      const serviceName = SUN_TIMES_META[key]?.name || service.displayName || 'Unknown';
      this.log.info(`[${this.platformName}] Removing sensor: ${serviceName}`);
      this.accessory.removeService(service);
    }
  }

  /**
   * Main calculation logic.
   * 1. Updates solar event times.
   * 2. Determines which event is currently "active" (Occupancy Detected).
   * 3. Schedules the next update based on the next chronological event.
   */
  updateSunTimes(dateOverride) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const now = dateOverride || new Date();

    // 1. Get raw solar times from Suncalc
    const sunDates = suncalc.getTimes(
      now,
      this.location.lat,
      this.location.lon
    );

    // 2. Apply user-defined offsets
    if (sunDates.sunriseEnd) {
      sunDates.sunriseEnd = new Date(
        sunDates.sunriseEnd.getTime() + (this.sunriseEndOffset * 60 * 1000)
      );
    }
    if (sunDates.sunsetStart) {
      sunDates.sunsetStart = new Date(
        sunDates.sunsetStart.getTime() + (this.sunsetStartOffset * 60 * 1000)
      );
    }

    // 3. Create a sorted timeline of events occurring today
    const sortedEvents = Object.entries(sunDates)
      .filter(([key, date]) =>
        date instanceof Date &&
        SUN_TIMES_META[key] &&
        this.enabledSensors.includes(key)
      )
      .sort((a, b) => a[1] - b[1]);

    // 4. Find the "active" solar window
    let activeKey = null;
    for (let i = 0; i < sortedEvents.length; i++) {
      const [key, startTime] = sortedEvents[i];
      const next = sortedEvents[i + 1];
      const endTime = next ? next[1] : null;

      if (now >= startTime && (!endTime || now < endTime)) {
        activeKey = key;
        break;
      }
    }

    // Fallback: If past the last event (e.g., late night), maintain the last event's state
    if (!activeKey && sortedEvents.length) {
      activeKey = sortedEvents[sortedEvents.length - 1][0];
    }

    // 5. Update HomeKit characteristics
    Object.entries(this.sensors).forEach(([key, sensor]) => {
      const timeStr = sunDates[key] instanceof Date ?
        sunDates[key].toLocaleTimeString() :
        'N/A';
      sensor.timeChar.updateValue(timeStr);

      // Only the currently active phase shows as "Occupied"
      const isOccupied = key === activeKey ?
        this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED :
        this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;

      sensor.service.updateCharacteristic(this.Characteristic.OccupancyDetected, isOccupied);
    });

    if (activeKey) {
      this.log.info(
        `[${this.platformName}] Current Solar Period: ` +
        `${SUN_TIMES_META[activeKey]?.name}`
      );
    }

    // 6. Schedule next update at the exact moment of the next solar event
    if (!dateOverride) {
      const upcoming = sortedEvents.map(e => e[1]).filter(d => d > now);
      const nextWait = upcoming.length ?
        Math.min(...upcoming) - now.getTime() + 1000 : // Next event + 1s buffer
        60 * 60 * 1000; // If day is done, check in 1 hour

      this.timer = setTimeout(() => this.updateSunTimes(), nextWait);
    }
  }

  /**
   * Destructor: Ensures timers are killed if the plugin/accessory is stopped.
   */
  cleanup() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}

module.exports = { SuncalcAccessory };