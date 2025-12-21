'use strict';

const mockHap = require('./mockHap');
const Suncalc2Platform = require('../src/platform');

const mockLog = {};
mockLog.info = msg => console.log(`[INFO] ${msg}`);
mockLog.debug = msg => console.debug(`[INFO] ${msg}`);
mockLog.error = msg => console.error(`[ERROR] ${msg}`);

const STYLES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[94m',
  bgRed: '\x1b[41m',
  bgWhite: '\x1b[47m',
  white: '\x1b[37m'
};

const style = (text, ...styleKeys) => {
  const codes = styleKeys.map(key => STYLES[key] || '').join('');
  return `${codes}${text}${STYLES.reset}`;
};

const mockApi = {
  hap: mockHap,
  platformAccessory: class {
    constructor(name, uuid) {
      this.displayName = name;
      this.UUID = uuid;
      this.context = {};
      this.services = [new mockHap.Service('Info', mockHap.Service.AccessoryInformation)];
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

async function runTestSuite() {
  console.log(style('--- STARTING PLUGIN TESTS ---', 'bold', 'blue'));

  // ---------------------------------------------------------
  // STAGE 1: Initialization & Cache Reuse
  // ---------------------------------------------------------
  console.log('\n>> STAGE 1: Lifecycle & Cache');
  const config = { name: 'Main', location: { lat: 51.5, lon: -0.1 } };
  const platform = new Suncalc2Platform(mockLog, config, mockApi);

  const uuid = mockApi.hap.uuid.generate('homebridge-suncalc-2:Main');
  const cachedAcc = new mockApi.platformAccessory('Main', uuid);
  platform.configureAccessory(cachedAcc);

  mockApi.emit('didFinishLaunching');
  await new Promise(r => setTimeout(r, 100));

  const instance = platform.platformAccessories.get(uuid)._instance;
  if (!instance) {
    throw new Error('Failed to create SuncalcAccessory instance.');
  }

  const isReused = platform.platformAccessories.get(uuid) === cachedAcc;
  const sensorCount = Object.keys(instance.sensors).length;

  console.log(`Cache Reused: ${isReused ?
    style('YES', 'bold', 'green') :
    style('NO', 'bold', 'red')}`);
  console.log(`Sensors Created: ${sensorCount === 14 ?
    style(`${sensorCount}/14`, 'bold', 'green') :
    style(`${sensorCount}/14`, 'bold', 'red')}`);

  // ---------------------------------------------------------
  // STAGE 2: Functional Time Periods
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
    const active = instance.sensors[check.key]
      .service
      .getCharacteristic(mockHap.Characteristic.OccupancyDetected)
      .value;
    console.log(`Period [${check.label}] at ${check.time}: ${active === 1 ?
      style('ACTIVE', 'bold', 'green') :
      style('INACTIVE', 'bold', 'red')}`);
    if (active !== 1) {
      throw new Error(`${check.label} failed to trigger.`);
    }
  }

  // ---------------------------------------------------------
  // STAGE 3: Offset Logic
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

  // Real sunset is currently ~18:11. With -30m, it triggers at 17:41.
  const checkTime = new Date('2024-03-20T17:50:00Z');
  offInstance.updateSunTimes(checkTime);
  const sunsetActive = offInstance.sensors['sunsetStart']
    .service.getCharacteristic(mockHap.Characteristic.OccupancyDetected).value;

  console.log(`Sunset (-30m offset) at 17:50Z: ${sunsetActive === 1 ?
    style('ACTIVE (Correct)', 'bold', 'green') :
    style('INACTIVE', 'bold', 'red')}`);

  if (sunsetActive === 1) {
    console.log(style('\nALL TESTS PASSED SUCCESSFULLY', 'bold', 'green'));
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error(`\nTEST SUITE CRASHED: ${err.message}`);
  process.exit(1);
});