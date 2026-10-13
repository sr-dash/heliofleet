#!/usr/bin/env python3
"""Collect notable space-weather events from NASA's DONKI catalogue.

Writes data/events.json with large flares (M5 and above), fast CMEs (1000 km/s
and above, with the most accurate cone-model analysis) and strong
geomagnetic storms (G3 and above, Kp 7- or more). DONKI serves at most 60 days
per request and does not allow cross-origin browser requests, so the page reads
this static file instead.

Usage:
  python scripts/fetch_events.py               # everything since 2010
  python scripts/fetch_events.py --incremental # the last 150 days, merged in
"""

import argparse
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API = "https://ccmc.gsfc.nasa.gov/DONKI-API/get"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "events.json"
START = date(2010, 1, 1)
WINDOW = 59  # DONKI rejects ranges longer than 60 days

MIN_FLARE = 5e-5    # M5.0 in W m^-2
MIN_CME_SPEED = 1000
MIN_KP = 6.67       # Kp 7- marks a G3 storm
CLASS_FLUX = {"A": 1e-8, "B": 1e-7, "C": 1e-6, "M": 1e-5, "X": 1e-4}


def get(kind, a, b):
    url = f"{API}/{kind}?startDate={a:%Y-%m-%d}&endDate={b:%Y-%m-%d}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                body = r.read().decode()
            return json.loads(body) if body.strip() else []
        except Exception:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))


def flux(cls):
    m = re.match(r"([ABCMX])(\d+(?:\.\d+)?)", cls or "")
    return CLASS_FLUX[m.group(1)] * float(m.group(2)) if m else 0.0


def g_scale(kp):
    return 5 if kp >= 8.67 else 4 if kp >= 7.67 else 3


def flares(rows):
    out = []
    for r in rows:
        if flux(r.get("classType")) < MIN_FLARE:
            continue
        out.append({
            "id": r["flrID"],
            "t": r.get("peakTime") or r["beginTime"],
            "cls": r["classType"],
            "loc": r.get("sourceLocation") or None,
            "ar": r.get("activeRegionNum"),
            "link": r.get("link"),
        })
    return out


def cmes(rows):
    out = []
    for r in rows:
        an = [a for a in r.get("cmeAnalyses") or [] if a.get("speed")]
        best = next((a for a in an if a.get("isMostAccurate")), an[0] if an else None)
        if not best or best["speed"] < MIN_CME_SPEED:
            continue
        out.append({
            "id": r["activityID"],
            "t": r["startTime"],
            "t21": best.get("time21_5"),
            "speed": round(best["speed"]),
            "lon": best.get("longitude"),
            "lat": best.get("latitude"),
            "half": best.get("halfAngle"),
            "type": best.get("type"),
            "src": r.get("sourceLocation") or None,
            "ar": r.get("activeRegionNum"),
            "link": r.get("link"),
        })
    return out


def storms(rows):
    out = []
    for r in rows:
        kps = [k["kpIndex"] for k in r.get("allKpIndex") or [] if k.get("kpIndex") is not None]
        if not kps or max(kps) < MIN_KP:
            continue
        out.append({
            "id": r["gstID"],
            "t": r["startTime"],
            "kp": max(kps),
            "g": g_scale(max(kps)),
            "link": r.get("link"),
        })
    return out


def windows(a, b):
    while a <= b:
        z = min(b, a + timedelta(days=WINDOW))
        yield a, z
        a = z + timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--incremental", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    today = datetime.now(timezone.utc).date()
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    start = today - timedelta(days=150) if args.incremental and old else START

    spans = list(windows(start, today))
    parsers = {"FLR": ("flares", flares), "CME": ("cmes", cmes), "GST": ("storms", storms)}
    found = {name: {} for name, _ in parsers.values()}
    jobs = [(kind, a, b) for kind in parsers for a, b in spans]
    with ThreadPoolExecutor(args.workers) as pool:
        for (kind, a, b), rows in zip(jobs, pool.map(lambda j: get(*j), jobs)):
            name, parse = parsers[kind]
            for ev in parse(rows):
                found[name][ev["id"]] = ev
            print(f"  {kind} {a}..{b}: {len(rows)} records", flush=True)

    cutoff = f"{start:%Y-%m-%d}"
    merged = {}
    for name in ("flares", "cmes", "storms"):
        keep = {e["id"]: e for e in old.get(name, []) if e["t"] < cutoff}
        keep.update(found[name])
        merged[name] = sorted(keep.values(), key=lambda e: e["t"])
    merged = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA CCMC DONKI (https://ccmc.gsfc.nasa.gov/DONKI/)",
        "criteria": {"flares": "class M5.0 and above", "cmes": f"speed {MIN_CME_SPEED} km/s and above",
                     "storms": "G3 and above (Kp 7- or more)"},
        **merged,
    }
    OUT.write_text(json.dumps(merged, separators=(",", ":")))
    print(f"wrote {OUT.name}: {len(merged['flares'])} flares, {len(merged['cmes'])} CMEs, {len(merged['storms'])} storms")


if __name__ == "__main__":
    main()
