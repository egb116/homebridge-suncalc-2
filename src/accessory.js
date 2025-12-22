// src/accessory.js

'use strict';

// suncalc is used to calculate sun position and sunlight phases based on lat/lon
const suncalc = require('suncalc');

/**
 * Metadata mapping for the 14 solar phases provided by suncalc.
 * These are used to generate the names and descriptions for HomeKit sensors.
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
    
    // Optional offsets (in minutes) to shift specific solar events
    this.sunriseEndOffset = config.offset?.sunriseEnd || 0;
    this.sunsetStartOffset = config.offset?.sunsetStart || 0;

    // Storage for service and characteristic instances
    this.sensors = {};

    this.setupAccessoryInfo();
    this.setupServices();
    this.updateSunTimes();
  }

  /**
   * Sets the standard "Accessory Information" service shown in HomeKit settings.
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
   * Iterates through SUN_TIMES_META to create 14 Occupancy Sensor services.
   */
  setupServices() {
    Object.keys(SUN_TIMES_META).forEach(key => {
      const meta = SUN_TIMES_META[key];
      const sensorName = `${this.platformName} ${meta.name}`;

      // Generate a deterministic UUID for each sub-service based on the main accessory UUID
      const serviceUuid = this.api.hap.uuid.generate(`${this.accessory.UUID}:${key}`);

      // Try to find an existing service (for persistent accessories) or create a new one
      let service = this.accessory.getServiceById(this.Service.OccupancySensor, serviceUuid);

      if (!service) {
        service = this.accessory.addService(
          this.Service.OccupancySensor,
          sensorName,
          serviceUuid
        );
      }

      // Update basic naming characteristics
      service.getCharacteristic(this.Characteristic.Name).updateValue(sensorName);

      // ConfiguredName allows users to rename the sensor in the Home app without warnings
      if (!service.testCharacteristic(this.Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
      }
      service.setCharacteristic(this.Characteristic.ConfiguredName, sensorName);

      // Create a custom characteristic to display the exact time of the event in text format
      const charUuid = this.api.hap.uuid.generate(`${serviceUuid}:time`);
      let timeChar = service.characteristics.find(c => c.UUID === charUuid);

      if (!timeChar) {
        // Defines a new String characteristic called 'Event Time'
        timeChar = service.addCharacteristic(new this.Characteristic('Event Time', charUuid));
        timeChar.setProps({
          format: this.api.hap.Formats.STRING,
          perms: [this.api.hap.Perms.PAIRED_READ, this.api.hap.Perms.NOTIFY]
        });
      }

      // Store references for the update loop
      this.sensors[key] = { service, timeChar };
    });
  }

  /**
   * The main logic loop: calculates solar times, updates sensor states, and schedules the next run.
   */
  updateSunTimes(dateOverride) {
    // Clear any existing timer to prevent race conditions or overlapping updates
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const now = dateOverride || new Date();
    
    // Calculate raw solar timestamps using coordinates
    const sunDates = suncalc.getTimes(
      now,
      this.location.lat,
      this.location.lon
    );

    // Apply user-defined offsets in milliseconds (min * 60 * 1000)
    if (sunDates.sunriseEnd) {
      sunDates.sunriseEnd = new Date(sunDates.sunriseEnd.getTime() +
        this.sunriseEndOffset * 60 * 1000);
    }
    if (sunDates.sunsetStart) {
      sunDates.sunsetStart = new Date(sunDates.sunsetStart.getTime() +
        this.sunsetStartOffset * 60 * 1000);
    }

    // Sort all solar events chronologically to determine the "active" window
    const sortedEvents = Object.entries(sunDates)
      .filter(([key, date]) => date instanceof Date && SUN_TIMES_META[key])
      .sort((a, b) => a[1] - b[1]);

    // Find which solar period we are currently in
    let activeKey = null;
    for (let i = 0; i < sortedEvents.length; i++) {
      const [key, startTime] = sortedEvents[i];
      const next = sortedEvents[i + 1];
      const endTime = next ? next[1] : null;

      // If 'now' is between the start of this event and the start of the next
      if (now >= startTime && (!endTime || now < endTime)) {
        activeKey = key;
        break;
      }
    }

    // Fallback: If we are past the last event of the day, the last event remains active
    if (!activeKey && sortedEvents.length) {
      activeKey = sortedEvents[sortedEvents.length - 1][0];
    }

    // Push updates to HomeKit
    Object.entries(this.sensors).forEach(([key, sensor]) => {
      // Update the human-readable time string (e.g., "12:04:15 PM")
      const timeStr = sunDates[key] instanceof Date ? sunDates[key].toLocaleTimeString() : 'N/A';
      sensor.timeChar.updateValue(timeStr);

      // Set Occupancy to 'Detected' ONLY if this is the current active solar period
      const isOccupied = key === activeKey ?
        this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED :
        this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;

      sensor.service.updateCharacteristic(this.Characteristic.OccupancyDetected, isOccupied);
    });

    if (activeKey) {
      this.log.info(
        `[${this.platformName}] Current Solar Period: ${
          SUN_TIMES_META[activeKey]?.name
        }`
      );
    }

    // Scheduling Logic:
    // 1. Filter for events that haven't happened yet today.
    // 2. Calculate time until the closest future event.
    // 3. Set a timeout for that duration + 1 second buffer.
    const upcoming = sortedEvents.map(e => e[1]).filter(d => d > now);
    const nextWait = upcoming.length ?
      Math.min(...upcoming) - now.getTime() + 1000 : 
      60 * 60 * 1000; // If no events left today, check again in 1 hour

    this.timer = setTimeout(() => this.updateSunTimes(), nextWait);
  }

  /**
   * Cleanup method to stop timers when the accessory is disabled or Homebridge restarts.
   */
  cleanup() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}

module.exports = { SuncalcAccessory };