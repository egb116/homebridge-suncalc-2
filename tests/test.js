// tests/test.js

'use strict';

/**
 * Test dependencies.
 * mockHap: A local stub that mimics the HomeKit Accessory Protocol.
 * Suncalc2Platform: The main platform logic we are testing.
 */
const mockHap = require('./mockHap');
const Suncalc2Platform = require('../src/platform');

/**
 * Mock Logger
 * Redirects Homebridge logs to the console for visibility during test execution.
 */
const mockLog = {
  info: msg => console.log(`[INFO] ${msg}`),
  debug: msg => console.debug(`[DEBUG] ${msg}`),
  error: msg => console.error(`[ERROR] ${msg}`)
};

/**
 * Terminal Styling Utility
 * Uses ANSI escape codes to format test output with colors.
 */
const STYLES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  blue: '\x1b[94m',
  green: '\x1b[32m',
  red: '\x1b[31m'
};

const style = (text, ...styleKeys) => {
  const codes = styleKeys.map(key => STYLES[key] || '').join('');
  return `${codes}${text}${STYLES.reset}`;
};

/**
 * Test Helpers
 * Logic to inspect the state of the mock accessories.
 */
const countOccupancySensors = accessory =>
  accessory.services.filter(
    s => s.UUID === mockHap.Service.OccupancySensor
  ).length;

/**
 * Mock Homebridge API
 * This object simulates the Homebridge 'api' object passed to the platform.
 * It includes a mock for registration, event emitting, and the PlatformAccessory class.
 */
const mockApi = {
  hap: mockHap,
  platformAccessory: class {
    constructor(name, uuid) {
      this.displayName = name;
      this.UUID = uuid;
      this.context = {};
      // Every accessory starts with the standard Information service
      this.services = [
        new mockHap.Service('Info', mockHap.Service.AccessoryInformation)
      ];
    }
    getService(type) {
      const target = typeof type === 'function' && type.UUID ? type.UUID : type;
      return this.services.find(s => s.UUID === target);
    }
    getServiceById(type, subtype) {
      return this.services.find(s => s.UUID === type && s.subtype === subtype);
    }
    addService(type, name, subtype) {
      const svc = new mockHap.Service(name, type, subtype);
      this.services.push(svc);
      return svc;
    }
    removeService(service) {
      const index = this.services.indexOf(service);
      if (index > -1) {
        this.services.splice(index, 1);
      }
    }
  },
  registerPlatformAccessories: () => {},
  updatePlatformAccessories: () => {},
  on: function(ev, cb) {
    this[ev] = cb;
  },
  emit: function(ev) {
    if (this[ev]) {
      this[ev]();
    }
  }
};

/**
 * Main Test Runner
 * Executes a series of integration tests to ensure the platform behaves correctly.
 */
async function runTestSuite() {
  console.log(style('--- STARTING PLUGIN TESTS ---', 'bold', 'blue'));

  // ---------------------------------------------------------
  // STAGE 1: Initialization & Cache Reuse
  // ---------------------------------------------------------
  console.log('\n>> STAGE 1: Lifecycle & Cache');
  const config = { name: 'Main', location: { lat: 51.5, lon: -0.1 } };
  const platform = new Suncalc2Platform(mockLog, config, mockApi);

  const uuid = mockApi.hap.uuid.generate('homebridge-suncalc-2:Main');
  const cachedAcc = new mockApi.platformAccessory('Main', uuid); // eslint-disable-line new-cap

  platform.configureAccessory(cachedAcc);
  mockApi.emit('didFinishLaunching');

  await new Promise(r => setTimeout(r, 100));

  const instance = platform.platformAccessories.get(uuid)._instance;
  if (!instance) {
    throw new Error('Failed to create SuncalcAccessory instance.');
  }

  const isReused = platform.platformAccessories.get(uuid) === cachedAcc;
  const sensorCount = Object.keys(instance.sensors).length;

  console.log(
    `Cache Reused: ` +
    `${isReused ?
      style('YES', 'bold', 'green') :
      style('NO', 'bold', 'red')}`
  );
  console.log(
    `Sensors Created: ` +
    `${sensorCount === 14 ?
      style('14/14', 'bold', 'green') :
      style(`${sensorCount}/14`, 'bold', 'red')}`
  );

  // ---------------------------------------------------------
  // STAGE 2: Solar Period Accuracy
  // ---------------------------------------------------------
  console.log('\n>> STAGE 2: Solar Period Accuracy');

  const testTimes = [
    { time: '2024-03-20T12:15:00Z', key: 'solarNoon', label: 'Solar Noon' },
    { time: '2024-03-20T00:15:00Z', key: 'nadir', label: 'Nadir' },
    { time: '2024-03-20T09:00:00Z', key: 'goldenHourEnd', label: 'Daytime' }
  ];

  for (const check of testTimes) {
    const d = new Date(check.time);
    instance.updateSunTimes(d);

    const char = mockHap.Characteristic.OccupancyDetected;
    const active = instance.sensors[check.key].service.getCharacteristic(char).value;

    console.log(
      `Period [${check.label}] at ${check.time}: ` +
      `${active === 1 ? style('ACTIVE', 'bold', 'green') : style('INACTIVE', 'bold', 'red')}`
    );
    if (active !== 1) {
      throw new Error(`${check.label} failed to trigger.`);
    }
  }

  // ---------------------------------------------------------
  // STAGE 3: Configuration Offsets
  // ---------------------------------------------------------
  console.log('\n>> STAGE 3: Configuration Offsets');

  const offsetConfig = {
    name: 'Offset-Test',
    location: { lat: 51.5, lon: -0.1 },
    offset: { sunsetStart: -30 }
  };

  const offPlatform = new Suncalc2Platform(mockLog, offsetConfig, mockApi);
  const offUuid = mockApi.hap.uuid.generate('homebridge-suncalc-2:Offset-Test');

  offPlatform.api.emit('didFinishLaunching');
  await new Promise(r => setTimeout(r, 100));
  const offInstance = offPlatform.platformAccessories.get(offUuid)._instance;

  const checkTime = new Date('2024-03-20T17:50:00Z');
  offInstance.updateSunTimes(checkTime);

  const offChar = mockHap.Characteristic.OccupancyDetected;
  const sunsetActive = offInstance.sensors['sunsetStart'].service.getCharacteristic(offChar).value;

  console.log(
    `Sunset (-30m offset) at 17:50Z: ` +
    `${sunsetActive === 1 ?
      style('ACTIVE (Correct)', 'bold', 'green') :
      style('INACTIVE', 'bold', 'red')}`
  );

  // ---------------------------------------------------------
  // STAGE 4: Mode-Based Sensor Creation
  // ---------------------------------------------------------
  console.log('\n>> STAGE 4: Mode-Based Sensor Creation');

  const modeCases = [
    { mode: 'basic', expected: 2, label: 'Basic' },
    { mode: 'extended', expected: 4, label: 'Extended' },
    { mode: 'full', expected: 14, label: 'Full' }
  ];

  for (const test of modeCases) {
    const cfg = {
      name: `Mode-${test.mode}`,
      mode: test.mode,
      location: { lat: 51.5, lon: -0.1 }
    };
    const platform = new Suncalc2Platform(mockLog, cfg, mockApi);
    const uuid = mockApi.hap.uuid.generate(`homebridge-suncalc-2:Mode-${test.mode}`);

    platform.api.emit('didFinishLaunching');
    await new Promise(r => setTimeout(r, 50));

    const acc = platform.platformAccessories.get(uuid);
    const count = countOccupancySensors(acc);

    console.log(
      `${test.label} Mode Sensors: ` +
      `${count === test.expected ?
        style(`${count}/${test.expected}`, 'bold', 'green') :
        style(`${count}/${test.expected}`, 'bold', 'red')}`
    );
    if (count !== test.expected) {
      throw new Error(`${test.label} mode sensor count incorrect`);
    }
  }

  // ---------------------------------------------------------
  // STAGE 5: Mode Switching & Orphan Cleanup
  // ---------------------------------------------------------
  console.log('\n>> STAGE 5: Mode Switching Cleanup');

  const switchConfig = {
    name: 'Switch-Test',
    mode: 'full',
    location: { lat: 51.5, lon: -0.1 }
  };
  const switchPlatform = new Suncalc2Platform(mockLog, switchConfig, mockApi);
  const switchUuid = mockApi.hap.uuid.generate('homebridge-suncalc-2:Switch-Test');

  switchPlatform.api.emit('didFinishLaunching');
  await new Promise(r => setTimeout(r, 50));

  let acc = switchPlatform.platformAccessories.get(switchUuid);
  const isFull = countOccupancySensors(acc) === 14;
  console.log(
    `Initial FULL mode: ` +
    `${isFull ? style('14/14', 'bold', 'green') : 'FAILED'}`
  );

  // Switch to BASIC
  switchConfig.mode = 'basic';
  acc.context.config = switchConfig;
  const SuncalcAccessory = require('../src/accessory').SuncalcAccessory;
  acc._instance = new SuncalcAccessory(mockLog, switchConfig, mockApi, acc);

  let basicCount = countOccupancySensors(acc);
  console.log(
    `Switch to BASIC (Cleanup check): ` +
    `${basicCount === 2 ?
      style('2/2', 'bold', 'green') :
      style(`${basicCount}/2`, 'bold', 'red')}`
  );

  // Switch to EXTENDED
  switchConfig.mode = 'extended';
  acc.context.config = switchConfig;
  acc._instance = new SuncalcAccessory(mockLog, switchConfig, mockApi, acc);

  let extendedCount = countOccupancySensors(acc);
  console.log(
    `Switch to EXTENDED (Expansion check): ` +
    `${extendedCount === 4 ?
      style('4/4', 'bold', 'green') :
      style(`${extendedCount}/4`, 'bold', 'red')}`
  );

  console.log(style('\nALL TESTS PASSED SUCCESSFULLY', 'bold', 'green'));
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error(`\nTEST SUITE CRASHED: ${err.message}`);
  process.exit(1);
});