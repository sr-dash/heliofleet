// Links into Helioviewer.org (https://helioviewer.org) for the current moment.
// Layer paths and date ranges come from the Helioviewer getDataSources API;
// Helioviewer shows the image nearest to the requested time.

import { dateFromJD } from './ephem.js';

const jdOf = (iso) => Date.parse(`${iso}T00:00Z`) / 864e5 + 2440587.5;
// scale: arcseconds per screen pixel, chosen so the layer's field fills the view
const L = (path, label, scale, start, end = null) => ({ path, label, scale, start: jdOf(start), end: end ? jdOf(end) : null });

export const HV_LAYERS = {
  sdo: [
    L('SDO,AIA,AIA,171', 'AIA 171', 2.42, '2010-06-02'),
    L('SDO,AIA,AIA,193', 'AIA 193', 2.42, '2010-06-02'),
    L('SDO,AIA,AIA,304', 'AIA 304', 2.42, '2010-06-02'),
    L('SDO,HMI,HMI,magnetogram', 'HMI magnetogram', 2.42, '2010-12-06'),
  ],
  soho: [
    L('SOHO,EIT,EIT,195', 'EIT 195', 2.42, '1996-01-15'),
    L('SOHO,LASCO,C2,white-light', 'LASCO C2', 12, '1997-02-21'),
    L('SOHO,LASCO,C3,white-light', 'LASCO C3', 56, '1997-02-20'),
  ],
  sta: [
    L('STEREO_A,SECCHI,EUVI,195', 'EUVI 195', 2.42, '2006-11-07'),
    L('STEREO_A,SECCHI,COR2,white-light', 'COR2', 30, '2006-12-29'),
  ],
  stb: [
    L('STEREO_B,SECCHI,EUVI,195', 'EUVI 195', 2.42, '2006-11-11', '2014-09-27'),
    L('STEREO_B,SECCHI,COR2,white-light', 'COR2', 30, '2007-01-10', '2014-09-27'),
  ],
  solo: [
    L('SOLO,EUI,FSI,174', 'EUI FSI 174', 4.8, '2020-05-12', '2025-01-31'),
  ],
  earth: [
    L('GONG,GONG,H-alpha,6562', 'GONG H-alpha', 2.42, '2015-12-22'),
    L('MLSO,COSMO,KCor,735', 'MLSO K-Cor', 4.8, '2013-09-30'),
  ],
};

export function hvUrl(jd, layer) {
  const date = dateFromJD(jd + 1 / 172800).toISOString().slice(0, 19);
  const layers = encodeURIComponent(`[${layer.path},1,100]`);
  return `https://helioviewer.org/?date=${date}.000Z&imageScale=${layer.scale}&centerX=0&centerY=0&imageLayers=${layers}`;
}

// Layers of a body that have data at jd
export const layersAt = (key, jd) => (HV_LAYERS[key] ?? []).filter((l) => jd >= l.start && (!l.end || jd <= l.end + 1));

// The general "solar images" link: AIA 193, or EIT 195 before SDO
export function defaultLayer(jd) {
  return layersAt('sdo', jd).find((l) => l.label === 'AIA 193') ?? layersAt('soho', jd)[0];
}
