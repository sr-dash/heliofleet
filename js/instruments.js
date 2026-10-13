// Fields of view of white-light coronagraphs and heliospheric imagers, drawn
// in the ecliptic plane as the range of elongation (angle from Sun centre, as
// seen from the spacecraft) that each instrument covers.
//
// unit 'rs': limits in solar radii in the plane of the sky (coronagraphs),
//            converted to elongation at the spacecraft's distance.
// unit 'deg': limits as elongation in degrees.
// side 'both':  centred on the Sun (both sides of the Sun line).
//      'east':  the solar-east side as seen from the spacecraft.
//      'ram':   ahead along the spacecraft's direction of travel.
//      'earth': the side of the Sun where Earth is (STEREO HI; the 2015 and
//               2023 spacecraft rolls kept the cameras on that side).
//
// Sources: Brueckner et al. 1995 (LASCO); Howard et al. 2008 and Eyles et al.
// 2009 (STEREO SECCHI COR2, HI); Antonucci et al. 2020 (Metis); Howard et al.
// 2020 (SoloHI); Vourlidas et al. 2016 (WISPR).

export const INSTRUMENTS = [
  { id: 'c2', sc: 'soho', name: 'LASCO C2', unit: 'rs', inner: 2.2, outer: 6, side: 'both' },
  { id: 'c3', sc: 'soho', name: 'LASCO C3', unit: 'rs', inner: 3.7, outer: 30, side: 'both' },
  { id: 'cor2a', sc: 'sta', name: 'COR2', unit: 'rs', inner: 2.5, outer: 15, side: 'both' },
  { id: 'hi1a', sc: 'sta', name: 'HI-1', unit: 'deg', inner: 4, outer: 24, side: 'earth' },
  { id: 'hi2a', sc: 'sta', name: 'HI-2', unit: 'deg', inner: 18.7, outer: 88.7, side: 'earth' },
  { id: 'cor2b', sc: 'stb', name: 'COR2', unit: 'rs', inner: 2.5, outer: 15, side: 'both' },
  { id: 'hi1b', sc: 'stb', name: 'HI-1', unit: 'deg', inner: 4, outer: 24, side: 'earth' },
  { id: 'hi2b', sc: 'stb', name: 'HI-2', unit: 'deg', inner: 18.7, outer: 88.7, side: 'earth' },
  { id: 'metis', sc: 'solo', name: 'Metis', unit: 'deg', inner: 1.6, outer: 2.9, side: 'both' },
  { id: 'solohi', sc: 'solo', name: 'SoloHI', unit: 'deg', inner: 5.4, outer: 44.9, side: 'east' },
  { id: 'wispri', sc: 'psp', name: 'WISPR-I', unit: 'deg', inner: 13.5, outer: 53, side: 'ram' },
  { id: 'wispro', sc: 'psp', name: 'WISPR-O', unit: 'deg', inner: 50, outer: 108, side: 'ram' },
];

export const INSTRUMENT = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));
