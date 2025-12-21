// index.js

'use strict';

const Suncalc2Platform = require('./src/platform');

module.exports = api => {
  api.registerPlatform('homebridge-suncalc-2', 'Suncalc2Platform', Suncalc2Platform);
};
