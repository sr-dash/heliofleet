#!/usr/bin/env python3
"""Build the reference values that tests/validate.mjs checks the site against.

Run by hand when the checks need new cases; the result is committed as
tests/reference.json, so the automatic check needs only Node. Requires
astropy and sunpy.

Three kinds of reference:
  interp  Horizons vectors at times between the stored samples, fetched
          fresh, to check the page's interpolation.
  helio   Stonyhurst and Carrington coordinates from SunPy for stored
          sample times, to check the page's heliographic coordinates.
  hpc     Helioprojective (Tx, Ty) from SunPy of points near the Sun as seen
          from Earth and from spacecraft, to check the sky-view projection.

Cases use dates at least a year old, which the monthly refresh no longer
refetches, so the values stay fixed.

Usage:  python scripts/make_reference.py
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import astropy.units as u
from astropy.coordinates import HeliocentricMeanEcliptic, SkyCoord, CartesianRepresentation
from astropy.time import Time
from sunpy.coordinates import HeliographicCarrington, HeliographicStonyhurst, Helioprojective

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_ephemeris import BODIES, query  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "tests" / "reference.json"
UTC = timezone.utc
JD_UNIX = 2440587.5
AU_KM = 149597870.7

# (body, date) pairs between stored samples: perihelia, cruise and L1
INTERP = [
    ("psp", "2024-12-24 11:53"), ("psp", "2023-09-27 23:28"), ("psp", "2021-06-15 07:41"),
    ("solo", "2022-03-26 13:17"), ("solo", "2024-10-08 05:05"),
    ("sta", "2012-07-23 02:00"), ("sta", "2023-08-13 17:40"),
    ("stb", "2013-05-01 09:30"), ("bepi", "2021-10-01 23:44"), ("maven", "2019-04-02 14:20"),
    ("earth", "2017-08-21 18:25"), ("aditya_geo", "2024-06-01 05:37"),
    ("soho_geo", "2015-03-20 09:46"), ("ace_geo", "2018-01-01 19:12"),
]
# (body, date) pairs on stored daily samples, for heliographic coordinates
HELIO = [
    ("psp", "2024-12-24 12:00"), ("psp", "2020-01-29 00:00"), ("solo", "2022-03-26 00:00"),
    ("solo", "2023-04-10 00:00"), ("sta", "2012-07-23 00:00"), ("sta", "2015-06-04 00:00"),
    ("stb", "2011-02-06 00:00"), ("bepi", "2022-06-23 00:00"), ("maven", "2017-09-10 00:00"),
    ("earth", "2010-06-01 00:00"), ("earth", "2024-04-08 00:00"),
]
# Observers for the sky-view check, and points near the Sun (solar radii)
HPC_OBSERVERS = [("earth", "2024-04-08 00:00"), ("solo", "2022-03-26 00:00"),
                 ("psp", "2024-12-24 12:00"), ("sta", "2023-08-13 00:00")]
POINTS = [(0.0, 0.0, 1.0), (0.6, -0.3, 0.7), (-1.4, 0.8, 0.2), (2.5, 1.5, -0.5), (-0.2, -1.9, 0.9)]


def parse(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)


def jd(t):
    return t.timestamp() / 86400 + JD_UNIX


def stored(key, t):
    """The stored sample of a body at a grid time (au, or km for geocentric)."""
    c = json.loads((DATA / key / f"{t.year}.json").read_text())
    k = round((jd(t) - c["t0"]) / c["step"])
    if abs(c["t0"] + k * c["step"] - jd(t)) > 1e-6:
        raise ValueError(f"{key} {t} is not a stored sample")
    return c["d"][3 * k:3 * k + 3]


def horizons(key, t):
    b = BODIES[key]
    return list(query(b["cmd"], b["center"], t, t + timedelta(minutes=1), 1, b["units"])[0][1:])


def ecliptic(xyz_au, t):
    return SkyCoord(CartesianRepresentation(*xyz_au, unit=u.au),
                    frame=HeliocentricMeanEcliptic(equinox="J2000", obstime=Time(t)))


def main():
    ref = {"generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "interp": [], "helio": [], "hpc": []}

    for key, s in INTERP:
        t = parse(s)
        ref["interp"].append({"key": key, "jd": jd(t), "p": horizons(key, t), "units": BODIES[key]["units"]})
        print(f"interp {key} {s}", flush=True)

    for key, s in HELIO:
        t = parse(s)
        p = stored(key, t)
        e = horizons("earth", t)  # Earth fixes the Carrington observer
        c = ecliptic(p, t)
        hgs = c.transform_to(HeliographicStonyhurst(obstime=Time(t)))
        hgc = c.transform_to(HeliographicCarrington(obstime=Time(t), observer=ecliptic(e, t).transform_to(HeliographicStonyhurst(obstime=Time(t)))))
        ref["helio"].append({"key": key, "jd": jd(t), "lon": hgs.lon.wrap_at(180 * u.deg).deg,
                             "lat": hgs.lat.deg, "carr": hgc.lon.wrap_at(360 * u.deg).deg})
        print(f"helio {key} {s}", flush=True)

    for key, s in HPC_OBSERVERS:
        t = parse(s)
        obs = ecliptic(stored(key, t), t).transform_to(HeliographicStonyhurst(obstime=Time(t)))
        frame = Helioprojective(observer=obs, obstime=Time(t))
        for (x, y, z) in POINTS:
            # Points given in solar radii in the observer's Heliocentric frame
            # would depend on the frame under test, so use Stonyhurst instead.
            r = (x * x + y * y + z * z) ** 0.5 + 1.0
            lon = x * 30.0
            lat = y * 20.0
            pt = SkyCoord(lon * u.deg, lat * u.deg, r * 695700 * u.km, frame=HeliographicStonyhurst(obstime=Time(t)))
            hel = pt.transform_to(HeliocentricMeanEcliptic(equinox="J2000", obstime=Time(t))).cartesian
            hpc = pt.transform_to(frame)
            ref["hpc"].append({
                "observer": key, "jd": jd(t),
                "point": [hel.x.to_value(u.au), hel.y.to_value(u.au), hel.z.to_value(u.au)],
                "tx": hpc.Tx.to_value(u.arcsec), "ty": hpc.Ty.to_value(u.arcsec),
            })
        print(f"hpc {key} {s}", flush=True)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(ref, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
