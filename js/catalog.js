// Bodies drawn on the map, and the preset moments offered as tags.

// Near-Earth spacecraft first (they share Earth's spot on the map and appear
// in the inset), then the deep-space fleet.
export const SPACECRAFT = [
  'sdo', 'soho', 'aditya', 'ace', 'wind', 'dscovr',
  'solo', 'psp', 'bepi', 'sta', 'stb', 'maven',
];
export const PLANETS = ['mercury', 'venus', 'mars'];
// Spacecraft drawn in the near-Earth inset, around the Sun-Earth L1 point.
export const L1_FLEET = ['soho', 'aditya', 'ace', 'wind', 'dscovr'];

// hid: JPL Horizons ID. near: sits at Earth's position at map scale.
// geoKey: geocentric series for the inset. derived: no heliocentric series,
// so the page adds Earth's position to the geocentric one.
export const BODIES = {
  earth: { name: 'Earth', short: 'Earth', kind: 'planet', hid: '399' },
  sdo: {
    name: 'Solar Dynamics Observatory', short: 'SDO', tag: 'SDO', agency: 'NASA', kind: 'sc',
    hid: '-136395', launch: '2010-02-11T15:23Z', near: true,
    note: 'Geosynchronous orbit; shown at Earth on the map.',
    fallback: 'earth',
  },
  soho: {
    name: 'SOHO', short: 'SOHO', tag: 'SOHO', agency: 'ESA / NASA', kind: 'sc',
    hid: '-21', launch: '1995-12-02T08:08Z', near: true, geoKey: 'soho_geo', derived: true,
  },
  aditya: {
    name: 'Aditya-L1', short: 'Aditya-L1', tag: 'Aditya', agency: 'ISRO', kind: 'sc',
    hid: '-156', launch: '2023-09-02T06:20Z', near: true, geoKey: 'aditya_geo',
  },
  ace: {
    name: 'Advanced Composition Explorer', short: 'ACE', tag: 'ACE', agency: 'NASA', kind: 'sc',
    hid: '-92', launch: '1997-08-25T14:39Z', near: true, geoKey: 'ace_geo', derived: true,
  },
  wind: {
    name: 'Wind', short: 'Wind', tag: 'Wind', agency: 'NASA', kind: 'sc',
    hid: '-8', launch: '1994-11-01T09:31Z', near: true, geoKey: 'wind_geo', derived: true,
  },
  dscovr: {
    name: 'Deep Space Climate Observatory', short: 'DSCOVR', tag: 'DSCOVR', agency: 'NOAA / NASA', kind: 'sc',
    hid: '-78', launch: '2015-02-11T23:03Z', near: true, geoKey: 'dscovr_geo', derived: true,
  },
  solo: {
    name: 'Solar Orbiter', short: 'Solar Orbiter', tag: 'SolO', agency: 'ESA / NASA', kind: 'sc',
    hid: '-144', launch: '2020-02-10T04:03Z',
  },
  psp: {
    name: 'Parker Solar Probe', short: 'Parker', tag: 'PSP', agency: 'NASA', kind: 'sc',
    hid: '-96', launch: '2018-08-12T07:31Z',
  },
  bepi: {
    name: 'BepiColombo', short: 'BepiColombo', tag: 'Bepi', agency: 'ESA / JAXA', kind: 'sc',
    hid: '-121', launch: '2018-10-20T01:45Z',
  },
  sta: {
    name: 'STEREO-A', short: 'STEREO-A', tag: 'ST-A', agency: 'NASA', kind: 'sc',
    hid: '-234', launch: '2006-10-26T00:52Z',
  },
  stb: {
    name: 'STEREO-B', short: 'STEREO-B', tag: 'ST-B', agency: 'NASA', kind: 'sc',
    hid: '-235', launch: '2006-10-26T00:52Z',
    lost: '2014-10-01T00:00Z',
    ended: '2018-10-17T00:00Z',
  },
  maven: {
    name: 'MAVEN', short: 'MAVEN', tag: 'MAVEN', agency: 'NASA', kind: 'sc',
    hid: '-202', launch: '2013-11-18T18:28Z', note: 'Mars orbit',
  },
  mercury: { name: 'Mercury', short: 'Mercury', kind: 'planet', hid: '199', period: 88 },
  venus: { name: 'Venus', short: 'Venus', kind: 'planet', hid: '299', period: 225 },
  mars: { name: 'Mars', short: 'Mars', kind: 'planet', hid: '499', period: 687 },
};

// Times are UT of greatest eclipse (NASA / Espenak catalogue, ΔT applied).
export const ECLIPSES = [
  { t: '2010-07-11T19:33Z', label: 'South Pacific', where: 'Cook Islands, Easter Island, Patagonia' },
  { t: '2012-11-13T22:12Z', label: 'Australia', where: 'Northern Queensland, South Pacific' },
  { t: '2013-11-03T12:46Z', label: 'Atlantic & Africa', where: 'Gabon, Congo, Uganda, Kenya', hybrid: true },
  { t: '2015-03-20T09:46Z', label: 'Svalbard', where: 'Faroe Islands, Svalbard' },
  { t: '2016-03-09T01:57Z', label: 'Indonesia', where: 'Sumatra, Borneo, Sulawesi' },
  { t: '2017-08-21T18:25Z', label: 'Great American', where: 'Oregon to South Carolina' },
  { t: '2019-07-02T19:23Z', label: 'South America', where: 'Chile, Argentina' },
  { t: '2020-12-14T16:13Z', label: 'Patagonia', where: 'Chile, Argentina' },
  { t: '2021-12-04T07:33Z', label: 'Antarctica', where: 'Antarctica' },
  { t: '2023-04-20T04:17Z', label: 'Ningaloo', where: 'Western Australia, Timor-Leste', hybrid: true },
  { t: '2024-04-08T18:17Z', label: 'North America', where: 'Mexico, USA, Canada' },
  { t: '2026-08-12T17:46Z', label: 'Iceland & Spain', where: 'Greenland, Iceland, Spain' },
  { t: '2027-08-02T10:07Z', label: 'Egypt', where: 'Spain, North Africa, Arabia' },
  { t: '2028-07-22T02:56Z', label: 'Australia', where: 'Australia, New Zealand' },
  { t: '2030-11-25T06:50Z', label: 'Southern Africa', where: 'Namibia, Botswana, South Africa, Australia' },
  { t: '2031-11-14T21:06Z', label: 'Pacific', where: 'Pacific Ocean, Panama', hybrid: true },
  { t: '2033-03-30T18:01Z', label: 'Alaska', where: 'Alaska, Russian Far East' },
  { t: '2034-03-20T10:17Z', label: 'Africa & Asia', where: 'Nigeria, Egypt, Iran, Afghanistan, India' },
];

export const MILESTONES = [
  { t: '2010-02-11T15:23Z', label: 'SDO launch', body: 'sdo' },
  { t: '2014-10-01T00:00Z', label: 'STEREO-B contact lost', body: 'stb' },
  { t: '2015-02-11T23:03Z', label: 'DSCOVR launch', body: 'dscovr' },
  { t: '2018-08-12T07:31Z', label: 'Parker launch', body: 'psp' },
  { t: '2018-10-20T01:45Z', label: 'BepiColombo launch', body: 'bepi' },
  { t: '2018-11-06T03:27Z', label: 'Parker perihelion 1', body: 'psp' },
  { t: '2020-02-10T04:03Z', label: 'Solar Orbiter launch', body: 'solo' },
  { t: '2020-06-15T00:00Z', label: 'Solar Orbiter perihelion 1', body: 'solo' },
  { t: '2023-09-02T06:20Z', label: 'Aditya-L1 launch', body: 'aditya' },
  { t: '2024-01-06T10:30Z', label: 'Aditya-L1 halo-orbit insertion', body: 'aditya' },
  { t: '2024-12-24T11:53Z', label: 'Parker closest perihelion', body: 'psp' },
];

export const SPACE_WEATHER = [
  { t: '2012-07-23T02:00Z', label: 'Near-miss Carrington-class CME', note: 'Recorded in situ by STEREO-A' },
  { t: '2017-09-06T12:02Z', label: 'X9.3 flare', note: 'Largest flare of solar cycle 24' },
  { t: '2017-09-10T16:06Z', label: 'X8.2 limb flare', note: 'Ground-level enhancement event' },
  { t: '2024-05-10T17:05Z', label: 'Gannon storm onset', note: 'G5 geomagnetic storm' },
  { t: '2024-10-03T12:18Z', label: 'X9.0 flare', note: 'Largest flare of solar cycle 25 so far' },
  { t: '2025-11-11T10:04Z', label: 'X5.1 flare', note: 'Followed by a G5 storm on 12 November' },
];

export const PRESET_GROUPS = [
  { id: 'eclipses', title: 'Eclipses', items: ECLIPSES },
  { id: 'milestones', title: 'Missions', items: MILESTONES },
  { id: 'weather', title: 'Space weather', items: SPACE_WEATHER },
];
