#!/usr/bin/env python3
"""Fetch spacecraft and planet ephemerides from JPL Horizons for HelioFleet.

Writes one JSON chunk per body per calendar year to data/<body>/<year>.json and
an index to data/manifest.json. Heliocentric vectors are in au, geocentric
vectors (used for the near-Earth inset) are in km. All vectors are referred to
the ICRF ecliptic (J2000) plane, sampled on a uniform UT grid.

Each spacecraft is fetched up to the end of its current Horizons ephemeris,
which moves forward as missions publish new predictions. The timeline (Earth,
planets, Moon) runs to the latest spacecraft end, so it grows with them.

Usage:
  python scripts/fetch_ephemeris.py               # full rebuild
  python scripts/fetch_ephemeris.py --incremental # refetch from last year on
  python scripts/fetch_ephemeris.py --only psp,solo --from-year 2026
"""

import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UTC = timezone.utc

APP_START = "2010-01-01"
# Keep in step with the cron line in .github/workflows/update-ephemeris.yml.
SCHEDULE_DAY, SCHEDULE_HOUR, SCHEDULE_MINUTE = 1, 6, 17

# end: None follows the Horizons ephemeris, "timeline" follows the latest
# spacecraft, another body key follows that body, a date is a hard stop.
BODIES = {
    "earth":      dict(cmd="399",     center="500@10",  step=24, units="au", start=APP_START,          end="timeline"),
    "mercury":    dict(cmd="199",     center="500@10",  step=24, units="au", start=APP_START,          end="timeline"),
    "venus":      dict(cmd="299",     center="500@10",  step=24, units="au", start=APP_START,          end="timeline"),
    "mars":       dict(cmd="499",     center="500@10",  step=24, units="au", start=APP_START,          end="timeline"),
    "moon_geo":   dict(cmd="301",     center="500@399", step=6,  units="km", start=APP_START,          end="timeline"),
    "sdo":        dict(cmd="-136395", center="500@10",  step=24, units="au", start="2010-02-12",       end=None),
    "sta":        dict(cmd="-234",    center="500@10",  step=24, units="au", start=APP_START,          end=None),
    "stb":        dict(cmd="-235",    center="500@10",  step=24, units="au", start=APP_START,          end="2018-10-18"),
    "psp":        dict(cmd="-96",     center="500@10",  step=3,  units="au", start="2018-08-12 12:00", end=None),
    "solo":       dict(cmd="-144",    center="500@10",  step=24, units="au", start="2020-02-11",       end=None),
    "aditya":     dict(cmd="-156",    center="500@10",  step=24, units="au", start="2023-09-03",       end=None),
    "aditya_geo": dict(cmd="-156",    center="500@399", step=2,  units="km", start="2023-09-02 10:00", end="aditya"),
    # Sun-Earth L1 monitors: geocentric only; the page adds Earth's position.
    "soho_geo":   dict(cmd="-21",     center="500@399", step=12, units="km", start=APP_START,          end=None),
    "ace_geo":    dict(cmd="-92",     center="500@399", step=12, units="km", start=APP_START,          end=None),
    "wind_geo":   dict(cmd="-8",      center="500@399", step=12, units="km", start=APP_START,          end=None),
    "dscovr_geo": dict(cmd="-78",     center="500@399", step=12, units="km", start="2015-02-12",       end=None),
    "bepi":       dict(cmd="-121",    center="500@10",  step=24, units="au", start="2018-10-21",       end=None),
    "maven":      dict(cmd="-202",    center="500@10",  step=24, units="au", start="2013-11-19",       end=None),
}

# Rows of the coverage table in README.md.
README_ROWS = [
    ("sdo", "SDO", "-136395", "shown at Earth after its ephemeris ends (geosynchronous orbit)"),
    ("soho_geo", "SOHO", "-21", "Sun-Earth L1"),
    ("aditya", "Aditya-L1", "-156", "Sun-Earth L1"),
    ("ace_geo", "ACE", "-92", "Sun-Earth L1"),
    ("wind_geo", "Wind", "-8", "Sun-Earth L1"),
    ("dscovr_geo", "DSCOVR", "-78", "Sun-Earth L1"),
    ("solo", "Solar Orbiter", "-144", ""),
    ("psp", "Parker Solar Probe", "-96", ""),
    ("sta", "STEREO-A", "-234", ""),
    ("stb", "STEREO-B", "-235", "contact lost 2014-10-01; later positions are predictions"),
    ("bepi", "BepiColombo", "-121", ""),
    ("maven", "MAVEN", "-202", "Mars orbit"),
]

JD_UNIX_EPOCH = 2440587.5
MONTHS = {m: i for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def from_jd(jd):
    return datetime.fromtimestamp((jd - JD_UNIX_EPOCH) * 86400.0, UTC)


def parse(s):
    fmt = "%Y-%m-%d %H:%M" if " " in s else "%Y-%m-%d"
    return datetime.strptime(s, fmt).replace(tzinfo=UTC)


def call(params):
    url = API + "?" + urllib.parse.urlencode({"format": "json", **params})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)["result"]
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def vector_params(command, center, start, stop, step):
    return {
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step}'",
    }


def available_end(command):
    """End of the body's Horizons ephemeris (TDB, within a minute of UT)."""
    far = datetime(2200, 1, 1, tzinfo=UTC)
    result = call({**vector_params(command, "500@10", far, far + timedelta(days=1), "1 d"), "OBJ_DATA": "NO"})
    m = re.search(r"after A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})", result)
    if not m:
        raise RuntimeError(f"Could not read the ephemeris end for {command}: {result[-300:]}")
    y, mon, d, hh, mm = m.groups()
    return datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), tzinfo=UTC)


def query(command, center, start, stop, step_h, units):
    step = f"{step_h} h" if step_h < 24 else f"{step_h // 24} d"
    params = {
        **vector_params(command, center, start, stop, step),
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
    result = call(params)
    if "$$SOE" not in result:
        raise RuntimeError(f"{command} {start}..{stop}: {result[-400:]}")
    body = result.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in body.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        rows.append((float(f[0]), float(f[2]), float(f[3]), float(f[4])))
    return rows


def last_grid(start, end, step_h):
    """Last sample time on the body's grid that is safely inside `end`."""
    step = timedelta(hours=step_h)
    n = int(((end - timedelta(minutes=5)) - start) / step)
    return start + n * step


def resolve_ends(keys):
    """Stop time for every requested body, probing Horizons for open ends."""
    ends = {}
    for key, b in BODIES.items():
        if b["end"] is None:
            ends[key] = available_end(b["cmd"])
            print(f"  {key}: Horizons ephemeris ends {ends[key]:%Y-%m-%d %H:%M}", flush=True)
    for key, b in BODIES.items():
        if b["end"] not in (None, "timeline") and b["end"] not in BODIES:
            ends[key] = parse(b["end"])
    timeline = max(v for k, v in ends.items() if BODIES[k]["end"] is None)
    timeline = timeline.replace(hour=0, minute=0, second=0, microsecond=0)
    for key, b in BODIES.items():
        if b["end"] == "timeline":
            ends[key] = timeline
        elif b["end"] in BODIES:
            ends[key] = ends[b["end"]]
    return {k: last_grid(parse(BODIES[k]["start"]), ends[k], BODIES[k]["step"]) for k in keys}


def fetch_body(key, end, from_year, old):
    b = BODIES[key]
    start = parse(b["start"])
    step = timedelta(hours=b["step"])
    outdir = DATA / key
    outdir.mkdir(parents=True, exist_ok=True)
    keep = [y for y in (old or {}).get("years", []) if y < from_year]
    fetched = []
    first = last = None
    for year in range(max(start.year, from_year), end.year + 1):
        y0 = max(start, datetime(year, 1, 1, tzinfo=UTC))
        y1 = min(end, datetime(year + 1, 1, 1, tzinfo=UTC) - step)
        if y1 <= y0:
            continue
        rows = query(b["cmd"], b["center"], y0, y1, b["step"], b["units"])
        nd = 7 if b["units"] == "au" else 0
        flat = []
        for _, x, y, z in rows:
            flat += [round(v, nd) if nd else int(round(v)) for v in (x, y, z)]
        chunk = {"t0": round(rows[0][0], 6), "step": b["step"] / 24, "n": len(rows), "d": flat}
        (outdir / f"{year}.json").write_text(json.dumps(chunk, separators=(",", ":")))
        fetched.append(year)
        first = rows[0][0] if first is None else first
        last = rows[-1][0]
        print(f"  {key} {year}: {len(rows)} samples", flush=True)
    # Drop chunks that now fall beyond the ephemeris (a shortened prediction).
    for f in outdir.glob("*.json"):
        if int(f.stem) > end.year:
            f.unlink()
    years = sorted(set(keep) | set(fetched))
    if not fetched:
        return key, old
    return key, {
        "units": b["units"],
        "center": "sun" if b["center"] == "500@10" else "earth",
        "step": b["step"] / 24,
        "start": old["start"] if keep and old else round(first, 6),
        "end": round(last, 6),
        "years": years,
    }


def next_update(now):
    this = now.replace(day=SCHEDULE_DAY, hour=SCHEDULE_HOUR, minute=SCHEDULE_MINUTE, second=0, microsecond=0)
    if this > now:
        return this
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(year, month, SCHEDULE_DAY, SCHEDULE_HOUR, SCHEDULE_MINUTE, tzinfo=UTC)


def update_docs(manifest):
    def day(jd):
        return from_jd(jd).strftime("%Y-%m-%d")

    bodies = manifest["bodies"]
    lines = ["| Spacecraft | Horizons ID | Coverage in this site |", "|---|---|---|"]
    for key, name, hid, note in README_ROWS:
        b = bodies[key]
        span = f"{day(b['start'])} to {day(b['end'])}"
        lines.append(f"| {name} | {hid} | {span}{'; ' + note if note else ''} |")
    lines.append("")
    lines.append(f"Timeline: {day(manifest['timeline']['start'])} to {day(manifest['timeline']['end'])}. "
                 f"Data last updated {manifest['generated'][:10]}; "
                 f"next scheduled update {manifest['next_update'][:10]}.")
    readme = ROOT / "README.md"
    text = readme.read_text()
    text = re.sub(r"(<!-- coverage:start -->).*?(<!-- coverage:end -->)",
                  lambda m: m.group(1) + "\n" + "\n".join(lines) + "\n" + m.group(2), text, flags=re.S)
    readme.write_text(text)
    sitemap = ROOT / "sitemap.xml"
    sitemap.write_text(re.sub(r"<lastmod>[^<]*</lastmod>",
                              f"<lastmod>{manifest['generated'][:10]}</lastmod>", sitemap.read_text()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated body keys")
    ap.add_argument("--from-year", type=int, default=0,
                    help="refetch chunks from this year on and keep older ones")
    ap.add_argument("--incremental", action="store_true",
                    help="refetch from the year of 60 days ago, which picks up revised predictions")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    now = datetime.now(UTC)
    from_year = (now - timedelta(days=60)).year if args.incremental else args.from_year
    keys = args.only.split(",") if args.only else list(BODIES)

    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"bodies": {}}
    ends = resolve_ends(keys)
    bodies = manifest["bodies"]
    with ThreadPoolExecutor(args.workers) as pool:
        jobs = [pool.submit(fetch_body, k, ends[k], from_year, bodies.get(k)) for k in keys]
        for job in jobs:
            key, info = job.result()
            if info:
                bodies[key] = info
    manifest["timeline"] = {"start": bodies["earth"]["start"], "end": bodies["earth"]["end"]}
    manifest["generated"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest["next_update"] = next_update(now).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest["source"] = "JPL Horizons, ICRF ecliptic J2000, UT sample grid"
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    update_docs(manifest)
    print(f"manifest written; timeline ends {from_jd(manifest['timeline']['end']):%Y-%m-%d}")


if __name__ == "__main__":
    main()
