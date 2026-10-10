// Bodies drawn on the map, and the preset moments offered as tags.

export const SPACECRAFT = ['sdo', 'aditya', 'solo', 'psp', 'sta', 'stb'];
export const PLANETS = ['mercury', 'venus', 'mars'];

export const BODIES = {
  earth: { name: 'Earth', short: 'Earth', kind: 'planet' },
  sdo: {
    name: 'Solar Dynamics Observatory', short: 'SDO', tag: 'SDO', agency: 'NASA', kind: 'sc',
    launch: '2010-02-11T15:23Z',
    note: 'Geosynchronous orbit; shown at Earth on the map.',
    fallback: 'earth',
  },
  aditya: {
    name: 'Aditya-L1', short: 'Aditya-L1', tag: 'Aditya', agency: 'ISRO', kind: 'sc',
    launch: '2023-09-02T06:20Z',
  },
  solo: {
    name: 'Solar Orbiter', short: 'Solar Orbiter', tag: 'SolO', agency: 'ESA / NASA', kind: 'sc',
    launch: '2020-02-10T04:03Z',
  },
  psp: {
    name: 'Parker Solar Probe', short: 'Parker', tag: 'PSP', agency: 'NASA', kind: 'sc',
    launch: '2018-08-12T07:31Z',
  },
  sta: {
    name: 'STEREO-A', short: 'STEREO-A', tag: 'ST-A', agency: 'NASA', kind: 'sc',
    launch: '2006-10-26T00:52Z',
  },
  stb: {
    name: 'STEREO-B', short: 'STEREO-B', tag: 'ST-B', agency: 'NASA', kind: 'sc',
    launch: '2006-10-26T00:52Z',
    lost: '2014-10-01T00:00Z',
    ended: '2018-10-17T00:00Z',
  },
  mercury: { name: 'Mercury', short: 'Mercury', kind: 'planet', period: 88 },
  venus: { name: 'Venus', short: 'Venus', kind: 'planet', period: 225 },
  mars: { name: 'Mars', short: 'Mars', kind: 'planet', period: 687 },
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
  { t: '2018-08-12T07:31Z', label: 'Parker launch', body: 'psp' },
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
  { t: '2025-11-11T10:04Z', label: 'X5.1 flare', note: 'Followed by a G4 storm' },
];

export const PRESET_GROUPS = [
  { id: 'eclipses', title: 'Eclipses', items: ECLIPSES },
  { id: 'milestones', title: 'Missions', items: MILESTONES },
  { id: 'weather', title: 'Space weather', items: SPACE_WEATHER },
];
