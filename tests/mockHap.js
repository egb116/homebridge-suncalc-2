// tests/mockHap.js

'use strict';

/**
 * HomeKit Accessory Protocol (HAP) Mock
 * This file provides a lightweight simulation of the HAP-NodeJS library.
 * It allows the test suite to run without installing the full Homebridge environment.
 */

// Standard UUID for Occupancy Sensors used by HomeKit
const OCCUPANCY_UUID = '00000071-0000-1000-8000-0026BB765291';

/**
 * Mock Characteristic Class
 * Represents individual data points (e.g., "Is Occupied?", "Manufacturer Name").
 */
class Characteristic {
  constructor(name, uuid) {
    this.name = name;
    this.UUID = uuid;
    this.value = null;
  }

  // Standard Apple-defined UUIDs for Accessory Information
  static Manufacturer = '00000020-0000-1000-8000-0026BB765291';
  static Model = '00000021-0000-1000-8000-0026BB765291';
  static SerialNumber = '00000030-0000-1000-8000-0026BB765291';
  static Name = '00000023-0000-1000-8000-0026BB765291';
  static ConfiguredName = '000000E2-0000-1000-8000-0026BB765291';

  /**
   * Mock for the OccupancyDetected characteristic.
   * Includes the static constants used for state logic (0 = No, 1 = Yes).
   */
  static OccupancyDetected = class extends Characteristic {
    static UUID = OCCUPANCY_UUID;
    static OCCUPANCY_NOT_DETECTED = 0;
    static OCCUPANCY_DETECTED = 1;
    constructor() {
      super('Occupancy Detected', OCCUPANCY_UUID);
    }
  };

  // HAP-NodeJS Property Enums
  static Formats = {
    STRING: 'string',
    UINT8: 'uint8',
    BOOLEAN: 'bool'
  };

  static Perms = {
    PAIRED_READ: 'pr',
    NOTIFY: 'ev'
  };

  /** Sets property constraints (mocked to just return the instance) */
  setProps() {
    return this;
  }

  /** Updates the internal value and mimics the HAP update behavior */
  updateValue(val) {
    this.value = val;
    return this;
  }
}

/**
 * Mock Service Class
 * Represents a group of characteristics (e.g., an "Occupancy Sensor" service).
 */
class Service {
  static AccessoryInformation = '0000003E-0000-1000-8000-0026BB765291';
  static OccupancySensor = OCCUPANCY_UUID;

  constructor(name, uuid, subtype) {
    this.displayName = name;
    this.UUID = uuid;
    this.subtype = subtype;
    // Every service starts with a default Name characteristic
    this.characteristics = [new Characteristic('Name', Characteristic.Name)];
  }

  /**
   * Retrieves a characteristic from the service.
   * If it doesn't exist and a class is provided, it instantiates it.
   */
  getCharacteristic(type) {
    const target = typeof type === 'function' && type.UUID ? type.UUID : type;
    let char = this.characteristics.find(c => c.UUID === target);

    if (!char && typeof type === 'function') {
      // Alias to Uppercase to satisfy 'new-cap' linting rule
      const CharacteristicConstructor = type;
      char = new CharacteristicConstructor();
      this.characteristics.push(char);
    }
    return char;
  }

  /** Checks if a specific characteristic UUID is present on this service */
  testCharacteristic(type) {
    const target = typeof type === 'function' && type.UUID ? type.UUID : type;
    return this.characteristics.some(c => c.UUID === target);
  }

  /** Adds a new characteristic instance to the service */
  addCharacteristic(charOrClass) {
    let instance;
    if (typeof charOrClass === 'function') {
      // Alias to Uppercase to satisfy 'new-cap' linting rule
      const Constructor = charOrClass;
      instance = new Constructor();
    } else {
      instance = charOrClass;
    }

    this.characteristics.push(instance);
    return instance;
  }

  /** Helper to quickly set a value on a characteristic */
  setCharacteristic(type, val) {
    return this.updateCharacteristic(type, val);
  }

  /** Logic to find and update a specific characteristic value */
  updateCharacteristic(type, val) {
    const char = this.getCharacteristic(type);
    if (char) {
      char.updateValue(val);
    }
    return this;
  }

  /** Mocked for compatibility; HomeKit sometimes adds non-required traits */
  addOptionalCharacteristic() {}
}

/**
 * Module Export
 * Replicates the structure of the Homebridge 'hap' object.
 */
module.exports = {
  Service,
  Characteristic,
  // Simplistic UUID generator: just returns the name as the UUID for testing purposes
  uuid: { generate: name => name },
  Formats: Characteristic.Formats,
  Perms: Characteristic.Perms
};