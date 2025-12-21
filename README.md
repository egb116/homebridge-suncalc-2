
# homebridge-suncalc-2

[Suncalc](https://github.com/mourner/suncalc) plugin for [Homebridge](https://github.com/homebridge/homebridge) that publishes 14 occupancy sensors aligning with Suncalc's time periods

| Suncalc Time Period | HomeKit Sensor Name                                 |
| ------------------- | --------------------------------------------------- |
| nightEnd            | Morning Twilight - Astronomical twilight starts     |
| nauticalDawn        | Nautical Dawn - Nautical twilight starts            |
| dawn                | Civil Dawn - Civil twilight starts                  |
| sunrise             | First Light - Sun starts appearing over the horizon | 
| sunriseEnd          | Morning Golden Hour - Sun is up, golden hour starts |
| goldenHourEnd       | Daytime - Golden hour ends, full day starts         |
| solarNoon           | Solar Noon - Sun is at its highest point in the sky |
| goldenHour          | Evening Golden Hour - Evening golden hour starts    |
| sunsetStart         | Sunset - Sun starts setting                         |
| sunset              | Evening Twilight - Sun falls below the horizon      |
| dusk                | Civil Dusk - Civil twilight ends                    |
| nauticalDusk        | Nautical Dusk - Nautical twilight ends              |
| night               | Nightfall - Astronomical twilight ends              |
| nadir               | Deepest Night - Darkest part of the night           |

This is intended for use in triggering scenes using times like sunrise and sunset, or adjacent to those events like the start of golden hour.

# Offset (Sunrise/Sunset only)

Triggering from a time relative to sunset/sunrise can be useful for light triggers, if the other time periods are not suitable. This plugin allows you to specify an offset for the end of sunrise, and the beginning of sunset. For instance, if you want to trigger a scene to start 30 minutes before sunset, you can specify an sunsetStart offset of -30 in the config. This fires the trigger 30 minutes earlier than normal, allowing your lights to come on as it gets darker at your location.

# Installation

1. Install Homebridge using your preferred method (you've probably done this already)
2. Install this plugin using by searching in the Homebridge UI or by running: `npm install -g homebridge-suncalc-2`
3. Use a website like [GPS Coordinates](https://www.gps-coordinates.net) to get your location's coordinates.
4. Save the configuration and restart Homebridge when prompted.

# Configuration

```json
{
  "name": "Home",
  "location": {
    "lat": 40.74844,
    "lon": -73.985664
  },
  "offset": {
      "sunriseEnd" : 30,
      "sunsetStart" : -30
  },
  "platform": "Suncalc2Platform"
}
```

Fields:

* `name` is the name of the published accessory (required, unique).
* `location` contains your location coordinates (required).
* `offset` contains offset values in minutes of when that event should be fired for sunrise/sunset. (optional).
* `platform` must be "Suncalc2Platform" (required).
