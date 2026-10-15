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
// mission: shown instead of the spacecraft name (instruments in Earth orbit,
//          drawn from Earth's position: a few thousand km does not matter
//          at coronal scales).
// from:    first date the instrument flew; not drawn before it.
// color:   body whose colour the field borrows (one without fields of its own),
//          so no two fields share a colour.
//
// Sources: Brueckner et al. 1995 (LASCO); Howard et al. 2008, Thompson et al.
// 2003 and Eyles et al. 2009 (STEREO SECCHI COR1, COR2, HI); Antonucci et al.
// 2020 (Metis); Howard et al. 2020 (SoloHI); Vourlidas et al. 2016 (WISPR);
// DeForest et al. 2025 (PUNCH NFI, WFI); ESA/SIDC (Proba-3 ASPIICS);
// NOAA SWPC (GOES-19 CCOR-1); NOAA NCEI (SWFO-L1 CCOR-2); Singh et al. 2025
// (Aditya-L1 VELC imaging channel).

export const INSTRUMENTS = [
  { id: 'c2', sc: 'soho', name: 'LASCO C2', unit: 'rs', inner: 2.2, outer: 6, side: 'both' },
  { id: 'c3', sc: 'soho', name: 'LASCO C3', unit: 'rs', inner: 3.7, outer: 30, side: 'both' },
  { id: 'cor1a', sc: 'sta', name: 'COR1', unit: 'rs', inner: 1.4, outer: 4, side: 'both' },
  { id: 'cor2a', sc: 'sta', name: 'COR2', unit: 'rs', inner: 2.5, outer: 15, side: 'both' },
  { id: 'hi1a', sc: 'sta', name: 'HI-1', unit: 'deg', inner: 4, outer: 24, side: 'earth' },
  { id: 'hi2a', sc: 'sta', name: 'HI-2', unit: 'deg', inner: 18.7, outer: 88.7, side: 'earth' },
  { id: 'cor1b', sc: 'stb', name: 'COR1', unit: 'rs', inner: 1.4, outer: 4, side: 'both' },
  { id: 'cor2b', sc: 'stb', name: 'COR2', unit: 'rs', inner: 2.5, outer: 15, side: 'both' },
  { id: 'hi1b', sc: 'stb', name: 'HI-1', unit: 'deg', inner: 4, outer: 24, side: 'earth' },
  { id: 'hi2b', sc: 'stb', name: 'HI-2', unit: 'deg', inner: 18.7, outer: 88.7, side: 'earth' },
  { id: 'metis', sc: 'solo', name: 'Metis', unit: 'deg', inner: 1.6, outer: 2.9, side: 'both' },
  { id: 'solohi', sc: 'solo', name: 'SoloHI', unit: 'deg', inner: 5.4, outer: 44.9, side: 'east' },
  { id: 'wispri', sc: 'psp', name: 'WISPR-I', unit: 'deg', inner: 13.5, outer: 53, side: 'ram' },
  { id: 'wispro', sc: 'psp', name: 'WISPR-O', unit: 'deg', inner: 50, outer: 108, side: 'ram' },
  { id: 'velc', sc: 'aditya', name: 'VELC', unit: 'rs', inner: 1.05, outer: 3, side: 'both', from: '2023-09-02' },
  { id: 'ccor2', sc: 'swfo', name: 'CCOR-2', unit: 'rs', inner: 3, outer: 22, side: 'both', from: '2025-09-24' },
  { id: 'aspiics', sc: 'earth', mission: 'Proba-3', name: 'ASPIICS', unit: 'rs', inner: 1.1, outer: 3, side: 'both', from: '2024-12-05', color: 'wind' },
  { id: 'ccor1', sc: 'earth', mission: 'GOES-19', name: 'CCOR-1', unit: 'rs', inner: 3.7, outer: 17, side: 'both', from: '2024-06-25', color: 'dscovr' },
  { id: 'nfi', sc: 'earth', mission: 'PUNCH', name: 'NFI', unit: 'deg', inner: 1.5, outer: 8, side: 'both', from: '2025-03-12', color: 'ace' },
  { id: 'wfi', sc: 'earth', mission: 'PUNCH', name: 'WFI', unit: 'deg', inner: 3, outer: 45, side: 'both', from: '2025-03-12', color: 'ace' },
];

export const INSTRUMENT = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

const jdOf = (iso) => Date.parse(`${iso}T00:00Z`) / 864e5 + 2440587.5;
// Whether the instrument was flying at jd
export const flyingAt = (ins, jd) => !ins.from || jd >= jdOf(ins.from);
// The body whose colour the field is drawn in
export const insColor = (ins) => ins.color ?? ins.sc;
// Name for labels, given the name of the instrument's spacecraft
export const insLabel = (ins, scName) => `${ins.mission ?? scName} ${ins.name}`;
// Name in a list already grouped by spacecraft
export const insShort = (ins) => (ins.mission ? `${ins.mission} ${ins.name}` : ins.name);
