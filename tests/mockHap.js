'use strict';

const OCCUPANCY_UUID = '00000071-0000-1000-8000-0026BB765291';

class Characteristic {
  constructor(name, uuid) {
    this.name = name;
    this.UUID = uuid;
    this.value = null;
  }

  static Manufacturer = '00000020-0000-1000-8000-0026BB765291';
  static Model = '00000021-0000-1000-8000-0026BB765291';
  static SerialNumber = '00000030-0000-1000-8000-0026BB765291';
  static Name = '00000023-0000-1000-8000-0026BB765291';
  static ConfiguredName = '000000E2-0000-1000-8000-0026BB765291';

  static OccupancyDetected = class extends Characteristic {
    static UUID = OCCUPANCY_UUID;
    static OCCUPANCY_NOT_DETECTED = 0;
    static OCCUPANCY_DETECTED = 1;
    constructor() {
      super('Occupancy Detected', OCCUPANCY_UUID);
    }
  };

  static Formats = {
    STRING: 'string',
    UINT8: 'uint8',
    BOOLEAN: 'bool'
  };

  static Perms = {
    PAIRED_READ: 'pr',
    NOTIFY: 'ev'
  };

  setProps() {
    return this;
  }

  updateValue(val) {
    this.value = val;
    return this;
  }
}

class Service {
  static AccessoryInformation = '0000003E-0000-1000-8000-0026BB765291';
  static OccupancySensor = OCCUPANCY_UUID;

  constructor(name, uuid, subtype) {
    this.displayName = name;
    this.UUID = uuid;
    this.subtype = subtype;
    this.characteristics = [new Characteristic('Name', Characteristic.Name)];
  }

  getCharacteristic(type) {
    const target = typeof type === 'function' && type.UUID ? type.UUID : type;
    let char = this.characteristics.find(c => c.UUID === target);
    if (!char && typeof type === 'function') {
      char = new type();
      this.characteristics.push(char);
    }
    return char;
  }

  testCharacteristic(type) {
    const target = typeof type === 'function' && type.UUID ? type.UUID : type;
    return this.characteristics.some(c => c.UUID === target);
  }

  addCharacteristic(charOrClass) {
    const instance = typeof charOrClass === 'function' ? new charOrClass() : charOrClass;
    this.characteristics.push(instance);
    return instance;
  }

  setCharacteristic(type, val) {
    return this.updateCharacteristic(type, val);
  }

  updateCharacteristic(type, val) {
    const char = this.getCharacteristic(type);
    if (char) {
      char.updateValue(val);
    }
    return this;
  }

  addOptionalCharacteristic() {}
}

module.exports = {
  Service,
  Characteristic,
  uuid: { generate: name => name },
  Formats: Characteristic.Formats,
  Perms: Characteristic.Perms
};
