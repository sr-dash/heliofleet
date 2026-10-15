#!/usr/bin/env python3
"""Fetch SDO/HMI synoptic magnetograms for HelioFleet's solar surface map.

Downloads the HMI radial-field Carrington rotation maps (hmi.Synoptic_Mr_small,
720 x 360, uniform in Carrington longitude and sine latitude) and the
daily-updated synoptic frame for the current rotation from JSOC. Each is kept
on its native sine-latitude grid, averaged 2 x 2 to 360 x 180 (1 degree in
longitude, 1/90 in sine latitude), and stored as an 8-bit grayscale PNG in
data/synoptic/:

  value 0      no data
  value 1-255  field from -20 G to +20 G (clipped), linear

The page colours the maps with a fixed +/-20 G range, so nothing is lost by
clipping. data/synoptic/index.json lists every map with its time range.

Usage:
  python scripts/fetch_synoptic.py           # new rotations and the daily frame
  python scripts/fetch_synoptic.py --all     # refetch every rotation
Standard library only.
"""

import json
import math
import re
import struct
import sys
import time
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "synoptic"
BASE = "http://jsoc.stanford.edu/data/hmi/synoptic/"
DAILY = "hmi.Mrdailysynframe_small_720s_nrt.fits"
CLIP = 20.0  # gauss
NLON, NLAT = 360, 180
JD_UNIX = 2440587.5
TAI_UTC = 37.0  # seconds, since 2017; HMI times are in TAI


def get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def read_fits(raw):
    """Header cards and float32 image of a simple (uncompressed) FITS file."""
    head = {}
    i = 0
    while True:
        block = raw[i:i + 2880].decode("ascii", "replace")
        i += 2880
        done = False
        for k in range(0, 2880, 80):
            card = block[k:k + 80]
            key = card[:8].strip()
            if key == "END":
                done = True
                break
            if card[8:10] == "= ":
                val = card[10:].split("/")[0].strip() if not card[10:].strip().startswith("'") else card[10:].split("'")[1]
                head[key] = val.strip()
        if done:
            break
    if int(head["BITPIX"]) != -32:
        raise ValueError("expected 32-bit float data")
    nx, ny = int(head["NAXIS1"]), int(head["NAXIS2"])
    data = struct.unpack(f">{nx * ny}f", raw[i:i + 4 * nx * ny])
    return head, nx, ny, data


def jd_of(tai):
    """JD (UTC) of an HMI time string such as 2025.07.16_17:08:58_TAI."""
    m = re.match(r"(\d{4})\.(\d\d)\.(\d\d)_(\d\d):(\d\d):(\d\d(?:\.\d+)?)", tai)
    y, mo, d, hh, mm, ss = m.groups()
    t = datetime(int(y), int(mo), int(d), int(hh), int(mm), tzinfo=timezone.utc) + timedelta(seconds=float(ss) - TAI_UTC)
    return round(t.timestamp() / 86400 + JD_UNIX, 6)


def resample(head, nx, ny, data):
    """Average 2 x 2 onto 1 degree in Carrington longitude and 1/90 in sine latitude."""
    crpix1, crval1, cdelt1 = float(head["CRPIX1"]), float(head["CRVAL1"]), float(head["CDELT1"])
    # The x axis is Carrington time; Carrington longitude = -Carrington time (mod 360)
    def col(lon):
        for n in range(-2, 3):
            # floor, not round: older maps sit exactly half a rotation in
            ct = 360.0 * (math.floor(crval1 / 360.0) + n) - lon
            x = crpix1 - 1 + (ct - crval1) / cdelt1
            if -0.5 <= x < nx - 0.5:
                return int(round(x)) % nx
        return None
    # Input rows whose centres fall in each output sine-latitude band (south to
    # north). The rows span sine latitude -1 to +1 uniformly; maps before about
    # 2016 carry an inconsistent CDELT2 (1/144), so it is not used.
    centre = [-1 + (k + 0.5) * 2 / ny for k in range(ny)]
    def rows(j):
        s0, s1 = -1 + j / 90, -1 + (j + 1) / 90
        return [k for k in range(ny) if s0 <= centre[k] < s1]
    rr = [rows(j) for j in range(NLAT)]
    cols = [[c for c in (col(i + 0.25), col(i + 0.75)) if c is not None] for i in range(NLON)]
    out = bytearray(NLON * NLAT)
    for j, r in enumerate(rr):
        for i, cc in enumerate(cols):
            vals = [data[k * nx + c] for k in r for c in cc]
            vals = [v for v in vals if v == v]  # drop NaN
            if not vals:
                continue
            v = max(-CLIP, min(CLIP, sum(vals) / len(vals)))
            # Row 0 of the PNG is the north pole
            out[(NLAT - 1 - j) * NLON + i] = 1 + int(round((v + CLIP) / (2 * CLIP) * 254))
    return bytes(out)


def write_png(path, pixels, w=NLON, h=NLAT):
    raw = b"".join(b"\x00" + pixels[y * w:(y + 1) * w] for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"maps": []}
    have = {m["cr"] for m in idx["maps"]}
    listing = get(BASE).decode("utf-8", "replace")
    crs = sorted({int(c) for c in re.findall(r"hmi\.Synoptic_Mr_small\.(\d{4})\.fits", listing)})
    todo = crs if "--all" in sys.argv else [c for c in crs if c not in have]
    maps = {m["cr"]: m for m in idx["maps"]}
    for cr in todo:
        head, nx, ny, data = read_fits(get(f"{BASE}hmi.Synoptic_Mr_small.{cr}.fits"))
        write_png(OUT / f"cr{cr}.png", resample(head, nx, ny, data))
        maps[cr] = {"cr": cr, "file": f"cr{cr}.png", "t0": jd_of(head["T_START"]), "t1": jd_of(head["T_STOP"])}
        print(f"  CR {cr}: {head['T_START'][:10]} to {head['T_STOP'][:10]}", flush=True)
    head, nx, ny, data = read_fits(get(BASE + DAILY))
    write_png(OUT / "daily.png", resample(head, nx, ny, data))
    last = max(maps.values(), key=lambda m: m["cr"])
    out = {
        "source": "SDO/HMI synoptic radial-field maps (hmi.Synoptic_Mr_small) and daily-updated synoptic frame, from JSOC",
        "encoding": "8-bit PNG, 360 x 180, Carrington longitude 0-360 left to right, sine latitude +1 to -1 top to bottom in uniform steps; 0 = no data, 1-255 = -20 to +20 G",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "maps": [maps[c] for c in sorted(maps)],
        # The daily frame stands in for the rotation in progress, up to its time
        "daily": {"file": "daily.png", "t0": last["t1"], "t1": jd_of(head["T_OBS"]), "cr": int(head["CAR_ROT"])},
    }
    idx_path.write_text(json.dumps(out, indent=1))
    size = sum(f.stat().st_size for f in OUT.glob("*.png")) / 1e6
    print(f"wrote {len(out['maps'])} rotation maps and the daily frame ({size:.1f} MB)")


if __name__ == "__main__":
    main()
