// src/accessory.js

'use strict';

const suncalc = require('suncalc');

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

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // The name of this instance (e.g., "Home" or "Cabin")
    this.platformName = config.name || 'Suncalc';

    this.location = config.location;
    this.sunriseEndOffset = config.offset?.sunriseEnd || 0;
    this.sunsetStartOffset = config.offset?.sunsetStart || 0;

    this.sensors = {};

    this.setupAccessoryInfo();
    this.setupServices();
    this.updateSunTimes();
  }

  setupAccessoryInfo() {
    const manufacturer = 'Homebridge Suncalc';
    const model = 'Solar Times Sensor';
    const serialNumber = this.accessory.UUID; // Uses the unique accessory UUID as SN

    const informationService = this.accessory.getService(this.Service.AccessoryInformation);
    if (informationService) {
      informationService
        .setCharacteristic(this.Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(this.Characteristic.Model, model)
        .setCharacteristic(this.Characteristic.SerialNumber, serialNumber);
    }
  }

  setupServices() {
    Object.keys(SUN_TIMES_META).forEach(key => {
      const meta = SUN_TIMES_META[key];

      const sensorName = `${this.platformName} ${meta.name}`;

      // UUID is seeded with the Accessory UUID to ensure isolation between instances
      const serviceUuid = this.api.hap.uuid.generate(`${this.accessory.UUID}:${key}`);

      let service = this.accessory.getServiceById(this.Service.OccupancySensor, serviceUuid);

      if (!service) {
        service = this.accessory.addService(
          this.Service.OccupancySensor,
          sensorName,
          serviceUuid
        );
      }

      // 1. Set standard Name characteristic
      service.getCharacteristic(this.Characteristic.Name).updateValue(sensorName);

      // 2. Add ConfiguredName as optional to override Home App display without warnings
      if (!service.testCharacteristic(this.Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
      }
      service.setCharacteristic(this.Characteristic.ConfiguredName, sensorName);

      // 3. Custom characteristic for the timestamp string
      const charUuid = this.api.hap.uuid.generate(`${serviceUuid}:time`);
      let timeChar = service.characteristics.find(c => c.UUID === charUuid);

      if (!timeChar) {
        timeChar = service.addCharacteristic(new this.Characteristic('Event Time', charUuid));
        timeChar.setProps({
          format: this.api.hap.Formats.STRING,
          perms: [this.api.hap.Perms.PAIRED_READ, this.api.hap.Perms.NOTIFY]
        });
      }

      this.sensors[key] = { service, timeChar };
    });
  }

  updateSunTimes(dateOverride) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const now = dateOverride || new Date(); // Used for tests
    const sunDates = suncalc.getTimes(
      now,
      this.location.lat,
      this.location.lon
    );

    // Apply specific offsets
    if (sunDates.sunriseEnd) {
      sunDates.sunriseEnd = new Date(sunDates.sunriseEnd.getTime() +
        this.sunriseEndOffset * 60 * 1000);
    }
    if (sunDates.sunsetStart) {
      sunDates.sunsetStart = new Date(sunDates.sunsetStart.getTime() +
        this.sunsetStartOffset * 60 * 1000);
    }

    // Sort events to find the current active period
    const sortedEvents = Object.entries(sunDates)
      .filter(([key, date]) => date instanceof Date && SUN_TIMES_META[key])
      .sort((a, b) => a[1] - b[1]);

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

    if (!activeKey && sortedEvents.length) {
      activeKey = sortedEvents[sortedEvents.length - 1][0];
    }

    // Update all 14 sensor services
    Object.entries(this.sensors).forEach(([key, sensor]) => {
      const timeStr = sunDates[key] instanceof Date ? sunDates[key].toLocaleTimeString() : 'N/A';
      sensor.timeChar.updateValue(timeStr);

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

    // Determine time until the next solar event
    const upcoming = sortedEvents.map(e => e[1]).filter(d => d > now);
    const nextWait = upcoming.length ?
      Math.min(...upcoming) - now.getTime() + 1000 :
      60 * 60 * 1000; // Default to 1 hour if no more events today

    this.timer = setTimeout(() => this.updateSunTimes(), nextWait);
  }

  cleanup() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}

module.exports = { SuncalcAccessory };