#!/usr/bin/env python3
"""Fetch spacecraft and planet ephemerides from JPL Horizons for HelioFleet.

Writes one JSON chunk per body per calendar year to data/<body>/<year>.json and
an index to data/manifest.json. Heliocentric vectors are in au, geocentric
vectors (used for the near-Earth inset) are in km. All vectors are referred to
the ICRF ecliptic (J2000) plane, sampled on a uniform UT grid.

Usage:  python scripts/fetch_ephemeris.py [--only psp,solo] [--workers 4]
"""

import argparse
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

APP_START = "2010-01-01"
APP_END = "2030-01-01"

# key: (Horizons command, center, step in hours, units, start, end)
BODIES = {
    "earth":      ("399",     "500@10",  24, "au", APP_START,          APP_END),
    "mercury":    ("199",     "500@10",  24, "au", APP_START,          APP_END),
    "venus":      ("299",     "500@10",  24, "au", APP_START,          APP_END),
    "mars":       ("499",     "500@10",  24, "au", APP_START,          APP_END),
    "moon_geo":   ("301",     "500@399",  6, "km", APP_START,          APP_END),
    "sdo":        ("-136395", "500@10",  24, "au", "2010-02-12",       "2026-11-15"),
    "sta":        ("-234",    "500@10",  24, "au", APP_START,          "2027-01-14"),
    "stb":        ("-235",    "500@10",  24, "au", APP_START,          "2018-10-18"),
    "psp":        ("-96",     "500@10",   3, "au", "2018-08-12 12:00", APP_END),
    "solo":       ("-144",    "500@10",  24, "au", "2020-02-11",       APP_END),
    "aditya":     ("-156",    "500@10",  24, "au", "2023-09-03",       "2027-01-21"),
    "aditya_geo": ("-156",    "500@399",  2, "km", "2023-09-02 10:00", "2027-01-21"),
}

JD_UNIX_EPOCH = 2440587.5


def to_jd(dt):
    return JD_UNIX_EPOCH + dt.timestamp() / 86400.0


def parse(s):
    fmt = "%Y-%m-%d %H:%M" if " " in s else "%Y-%m-%d"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


def query(command, center, start, stop, step_h, units):
    step = f"{step_h} h" if step_h < 24 else f"{step_h // 24} d"
    params = {
        "format": "json",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step}'",
        "TIME_TYPE": "UT",
        "REF_PLANE": "ECLIPTIC",
        "REF_SYSTEM": "ICRF",
        "VEC_TABLE": "1",
        "VEC_CORR": "NONE",
        "OUT_UNITS": "AU-D" if units == "au" else "KM-S",
        "CSV_FORMAT": "YES",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                result = json.load(r)["result"]
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))
    if "$$SOE" not in result:
        raise RuntimeError(f"{command} {start}..{stop}: {result[-400:]}")
    body = result.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in body.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        rows.append((float(f[0]), float(f[2]), float(f[3]), float(f[4])))
    return rows


def fetch_body(key):
    command, center, step_h, units, s, e = BODIES[key]
    start, end = parse(s), parse(e)
    step = timedelta(hours=step_h)
    outdir = DATA / key
    outdir.mkdir(parents=True, exist_ok=True)
    years, first, last = [], None, None
    for year in range(start.year, end.year + 1):
        y0 = max(start, datetime(year, 1, 1, tzinfo=timezone.utc))
        y1 = min(end, datetime(year + 1, 1, 1, tzinfo=timezone.utc) - step)
        if y1 <= y0:
            continue
        rows = query(command, center, y0, y1, step_h, units)
        nd = 7 if units == "au" else 0
        flat = []
        for _, x, y, z in rows:
            flat += [round(v, nd) if nd else int(round(v)) for v in (x, y, z)]
        chunk = {"t0": round(rows[0][0], 6), "step": step_h / 24, "n": len(rows), "d": flat}
        (outdir / f"{year}.json").write_text(json.dumps(chunk, separators=(",", ":")))
        years.append(year)
        first = rows[0][0] if first is None else first
        last = rows[-1][0]
        print(f"  {key} {year}: {len(rows)} samples", flush=True)
    return key, {
        "units": units,
        "center": "sun" if center == "500@10" else "earth",
        "step": step_h / 24,
        "start": round(first, 6),
        "end": round(last, 6),
        "years": years,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated body keys")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    keys = args.only.split(",") if args.only else list(BODIES)

    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"bodies": {}}
    with ThreadPoolExecutor(args.workers) as pool:
        for key, info in pool.map(fetch_body, keys):
            manifest["bodies"][key] = info
    manifest["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    manifest["source"] = "JPL Horizons, ICRF ecliptic J2000, UT sample grid"
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    print("manifest written")


if __name__ == "__main__":
    main()
