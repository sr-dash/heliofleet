#!/usr/bin/env python3
"""Health check of the ephemeris data in data/.

For every body in data/manifest.json:
  - each listed year has a chunk, with the sample count its header claims;
  - samples are finite, on the body's step, and continue across year files;
  - positions are in a sane range (heliocentric au, geocentric km);
  - no jump between neighbouring samples is faster than a spacecraft can move;
  - the manifest's start and end match the chunks.
Missions still flying should have an ephemeris reaching at least a week past
today; one that does not is reported as stale (a warning, since Horizons
sometimes lags), and as an error once it is more than 60 days behind.

Exit status 1 on any error. Usage:
  python scripts/check_data.py             # everything
  python scripts/check_data.py --no-stale  # skip the date-dependent check
"""

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
JD_UNIX = 2440587.5
AU_KM = 149597870.7
# Fastest plausible motion between samples (km/s): Parker peaks near 192 km/s
# heliocentric; geocentric series move far more slowly except near launch.
MAX_SPEED = {"au": 260.0, "km": 12.0}
# Distance ranges: heliocentric au; geocentric km (Moon, L1 and transfer orbits)
RANGE = {"au": (0.03, 1.8), "km": (6.0e3, 2.2e6)}
MAX_SPEED_GEO_LAUNCH_DAYS = 10  # launch phase: fast near Earth


def now_jd():
    return datetime.now(timezone.utc).timestamp() / 86400 + JD_UNIX


def day(jd):
    return datetime.fromtimestamp((jd - JD_UNIX) * 86400, timezone.utc).strftime("%Y-%m-%d")


def flying(key):
    """Bodies the catalogue does not mark as lost or ended, by Horizons key."""
    cat = (ROOT / "js" / "catalog.js").read_text()
    done = set()
    for m in re.finditer(r"\n  (\w+): \{(.*?)\n  \},", cat, re.S):
        if re.search(r"\b(lost|ended):", m.group(2)):
            done.add(m.group(1))
            geo = re.search(r"geoKey: '(\w+)'", m.group(2))
            if geo:
                done.add(geo.group(1))
    return key not in done


def main():
    manifest = json.loads((DATA / "manifest.json").read_text())
    errors, warnings = [], []
    today = now_jd()
    for key, b in sorted(manifest["bodies"].items()):
        units, step = b["units"], b["step"]
        lo, hi = RANGE[units]
        prev = None
        first = last = None
        for year in b["years"]:
            path = DATA / key / f"{year}.json"
            if not path.exists():
                errors.append(f"{key}: missing {path.relative_to(ROOT)}")
                continue
            c = json.loads(path.read_text())
            d = c["d"]
            if len(d) != 3 * c["n"] or abs(c["step"] - step) > 1e-9:
                errors.append(f"{key} {year}: header says {c['n']} samples at step {c['step']}, file has {len(d) // 3}")
                continue
            for k in range(c["n"]):
                t = c["t0"] + k * step
                p = d[3 * k:3 * k + 3]
                if not all(math.isfinite(v) for v in p):
                    errors.append(f"{key}: non-finite sample at {day(t)}")
                    break
                r = math.sqrt(sum(v * v for v in p))
                if key != "moon_geo" and not lo <= r <= hi and not (units == "km" and t - b["start"] < MAX_SPEED_GEO_LAUNCH_DAYS):
                    errors.append(f"{key}: distance {r:.4g} {units} out of range at {day(t)}")
                    break
                if prev:
                    pt, pp = prev
                    gap = t - pt
                    if abs(gap - step) > 1e-6:
                        errors.append(f"{key}: gap of {gap:.3f} d before {day(t)} (step {step} d)")
                    dist = math.sqrt(sum((a - b_) ** 2 for a, b_ in zip(p, pp))) * (AU_KM if units == "au" else 1)
                    speed = dist / (gap * 86400)
                    near_launch = t - b["start"] < MAX_SPEED_GEO_LAUNCH_DAYS
                    if speed > MAX_SPEED[units] and not near_launch and key != "moon_geo":
                        errors.append(f"{key}: jump of {dist:.0f} km in {gap * 24:.1f} h before {day(t)}")
                prev = (t, p)
                first = t if first is None else first
                last = t
        if first is not None:
            if abs(first - b["start"]) > 1e-6 or abs(last - b["end"]) > 1e-6:
                errors.append(f"{key}: manifest says {day(b['start'])} to {day(b['end'])}, chunks hold {day(first)} to {day(last)}")
        body = key.removesuffix("_geo")
        if "--no-stale" not in sys.argv and b.get("center") is not None and flying(body) and key not in ("earth", "mercury", "venus", "mars", "moon_geo"):
            behind = today + 7 - b["end"]
            if behind > 60:
                errors.append(f"{key}: ephemeris ends {day(b['end'])}, more than 60 days before next week")
            elif behind > 0:
                warnings.append(f"{key}: ephemeris ends {day(b['end'])}, less than a week ahead")
    # Synoptic magnetograms (scripts/fetch_synoptic.py)
    syn = DATA / "synoptic" / "index.json"
    if syn.exists():
        idx = json.loads(syn.read_text())
        prev = None
        for m in idx["maps"] + [idx["daily"]]:
            f = DATA / "synoptic" / m["file"]
            if not f.exists() or f.stat().st_size < 1000:
                errors.append(f"synoptic: {m['file']} missing or empty")
            if not m["t0"] < m["t1"]:
                errors.append(f"synoptic: {m['file']} has an empty time range")
            if prev and m["t0"] < prev["t1"] - 0.1:
                errors.append(f"synoptic: {m['file']} overlaps {prev['file']}")
            prev = m
    else:
        warnings.append("synoptic: data/synoptic/index.json not found")
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}")
    n = len(manifest["bodies"])
    print(f"{n} series checked: {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
