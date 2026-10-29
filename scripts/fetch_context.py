#!/usr/bin/env python3
"""Fetch SDO context images for the DKIST Cryo-NIRSP footprints in the sky view.

Groups the datasets in data/ground/cryonirsp.json into observing runs (gaps of
more than an hour, at most three hours each, one target each), and for each run fetches a
720 x 720 cutout around its footprints and a 512 x 512 full-disk image, in
SDO/AIA 171, AIA 193 and the HMI line-of-sight magnetogram, from the
Helioviewer API. Cutouts are centred on the
footprints in helioprojective arcseconds, solar north up, and stored as JPEG in
data/ground/context/, listed in data/ground/context/index.json together with
the time of the image Helioviewer used.

Usage:
  python scripts/fetch_context.py                     # runs without images yet
  python scripts/fetch_context.py --date 2022-10-18   # only runs on that date
  python scripts/fetch_context.py --all               # refetch everything
Needs Pillow and NumPy.

Pointing check: near-real-time AIA frames (and frames taken during SDO's
calibration manoeuvres) carry the nominal pointing, so Helioviewer can place the
Sun off centre. For each image a small full-disk frame is fetched first and the
limb fitted; if the disk centre is more than CHECK_TOL off, the full-disk image
is requested with that offset, the offset refined on it, and the zoomed cutout
requested with the refined offset, so both line up with the footprints. The measured
offset is kept as "shift" (arcsec) in the index.
"""

import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "ground" / "cryonirsp.json"
OUT = ROOT / "data" / "ground" / "context"
API = "https://api.helioviewer.org/v2/"
SIZE = 720                 # pixels on a side of the zoomed cutout
DISK = 512                 # pixels on a side of the full-disk image
MIN_SCALE = 0.6            # arcsec per pixel, about AIA and HMI native
MIN_FIELD = 400.0          # arcsec, smallest cutout side
GAP = timedelta(hours=1)   # a longer gap starts a new run
SPAN = timedelta(hours=3)  # longest run
MOVE = 400.0               # arcsec; a footprint this far from the run's first starts a new run
CHECK = (256, 12.0)        # pixels and arcsec per pixel of the pointing-check frame
CHECK_TOL = 30.0           # arcsec; smaller offsets are within the check's own error
VERSION = 2                # cutouts made before this are fetched again
CHANNELS = {
    "aia171": ("[SDO,AIA,AIA,171,1,100]", 10, "RGB"),
    "aia193": ("[SDO,AIA,AIA,193,1,100]", 11, "RGB"),
    "hmi": ("[SDO,HMI,HMI,magnetogram,1,100]", 19, "L"),
}


def t_of(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(10 * (attempt + 1))


def centre(d):
    return sum(d["x"][:-1]) / (len(d["x"]) - 1), sum(d["y"][:-1]) / (len(d["y"]) - 1)


def runs(datasets):
    """Datasets grouped into observing runs, in time order."""
    out = []
    for d in sorted(datasets, key=lambda d: d["t0"]):
        t0, t1 = t_of(d["t0"]), t_of(d["t1"])
        r = out[-1] if out else None
        near = r and math.dist(centre(d), centre(r["ds"][0])) <= MOVE
        if near and t0 - r["t1"] <= GAP and t1 - r["t0"] <= SPAN:
            r["ds"].append(d)
            r["t1"] = max(r["t1"], t1)
        else:
            out.append({"t0": t0, "t1": t1, "ds": [d]})
    return out


def frame(ds):
    """Centre (arcsec) and scale (arcsec per pixel) that hold every footprint."""
    xs = [v for d in ds for v in d["x"]]
    ys = [v for d in ds for v in d["y"]]
    side = max(max(xs) - min(xs), max(ys) - min(ys), MIN_FIELD / 1.2) * 1.2
    scale = max(MIN_SCALE, side / SIZE)
    return round((max(xs) + min(xs)) / 2, 1), round((max(ys) + min(ys)) / 2, 1), round(scale, 3)


def screenshot(t, layer, x0, y0, scale, size):
    q = urllib.parse.urlencode({
        "date": t, "imageScale": scale, "layers": layer,
        # Helioviewer counts y0 downward, opposite to helioprojective y
        "x0": x0, "y0": -y0,
        "width": size, "height": size, "display": "true", "watermark": "false"})
    return get(f"{API}takeScreenshot/?{q}")


def limb_offset(png, rsun, check=CHECK):
    """Where the disk centre sits in a Sun-centred check frame, in arcsec (+x west, +y north)."""
    n, sc = check
    a = np.asarray(Image.open(io.BytesIO(png)).convert("L"), dtype=float)
    a = (a[:-2, :-2] + a[1:-1, :-2] + a[2:, :-2] + a[:-2, 1:-1] + a[1:-1, 1:-1] + a[2:, 1:-1]
         + a[:-2, 2:] + a[1:-1, 2:] + a[2:, 2:]) / 9  # 3 x 3 smoothing; pixel (i, j) is now (i + 1, j + 1)
    R = rsun / sc
    # Start from the centroid of the bright disk, which the whole check frame holds
    m = a > 0.5 * np.median(a[a > 0.25 * a.max()])
    ys, xs = np.nonzero(m)
    if len(xs) < 100:
        return None
    cx, cy = xs.mean() + 1, ys.mean() + 1
    # Steepest outward drop in brightness along rays, then a circle of the known radius
    for lo, hi in ((0.8, 1.2), (0.85, 1.15), (0.9, 1.1), (0.9, 1.1)):
        pts = []
        rr = np.arange(lo * R, hi * R, 0.5)
        for th in np.radians(np.arange(0, 360, 2)):
            xs, ys = cx + rr * np.cos(th), cy - rr * np.sin(th)
            ok = (xs >= 1) & (xs < n - 3) & (ys >= 1) & (ys < n - 3)
            if ok.sum() < 0.8 * len(rr):
                continue
            g = np.diff(a[ys[ok].round().astype(int) - 1, xs[ok].round().astype(int) - 1])
            i = int(np.argmin(g))
            if g[i] < -2:
                pts.append((xs[ok][i], ys[ok][i]))
        if len(pts) < 20:
            return None
        p = np.array(pts)
        for _ in range(8):
            d = np.hypot(p[:, 0] - cx, p[:, 1] - cy)
            res = d - R
            keep = np.abs(res - np.median(res)) < max(1.5, 2.5 * np.median(np.abs(res - np.median(res))))
            u = (p[keep] - [cx, cy]) / d[keep, None]
            # Least-squares shift of the centre for a circle of radius R + median offset
            step, *_ = np.linalg.lstsq(u, res[keep] - np.median(res[keep]), rcond=None)
            cx, cy = cx + step[0], cy + step[1]
    # Helioviewer puts the requested centre at pixel n / 2
    return round(float(cx - n / 2) * sc, 1), round(float(n / 2 - cy) * sc, 1)


def fetch(path, t, layer, source, mode, x0, y0, scale, size):
    """One Helioviewer cutout saved as JPEG; returns the image's own time, or None."""
    try:
        png = screenshot(t, layer, x0, y0, scale, size)
        info = json.loads(get(f"{API}getClosestImage/?date={t}&sourceId={source}"))
    except Exception as e:
        print(f"  {path.name}: failed ({e})", flush=True)
        FAILED.append(path.name)
        return None, None
    Image.open(io.BytesIO(png)).convert(mode).save(path, quality=80, optimize=True)
    time.sleep(1)
    return info["date"].replace(" ", "T") + "Z", png


def disk_scale(ds):
    """Full-disk scale that also holds the farthest footprint."""
    far = max(abs(v) for d in ds for v in d["x"] + d["y"])
    return round(max(2 * 1100.0, 2 * far + 150) / DISK, 3)


def main():
    args = sys.argv[1:]
    only = args[args.index("--date") + 1] if "--date" in args else None
    redo = "--all" in args
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    old = {s["key"]: s for s in json.loads(idx_path.read_text())["sets"]} if idx_path.exists() else {}
    sets = []
    for r in runs(json.loads(SRC.read_text())["datasets"]):
        key = r["t0"].strftime("%Y%m%dT%H%M")
        x0, y0, scale = frame(r["ds"])
        mid = iso(r["t0"] + (r["t1"] - r["t0"]) / 2)
        s = {"key": key, "v": VERSION, "t": mid, "x0": x0, "y0": y0, "scale": scale, "size": SIZE,
             "ids": [d["id"] for d in r["ds"]], "img": {},
             "disk": {"scale": disk_scale(r["ds"]), "size": DISK, "img": {}}}
        prev = old.get(key) or {}
        same = prev.get("v") == VERSION and (prev["x0"], prev["y0"], prev["scale"]) == (x0, y0, scale)
        same_disk = prev.get("disk", {}).get("scale") == s["disk"]["scale"]
        wanted = only is None or mid[:10] == only
        rsun = r["ds"][0]["rsun"]
        for ch, (layer, source, mode) in CHANNELS.items():
            had = prev.get("img", {}).get(ch), prev.get("disk", {}).get("img", {}).get(ch)
            names = f"{key}_{ch}.jpg", f"{key}_{ch}_disk.jpg"
            kept = (same and same_disk and all(had) and all((OUT / n).exists() for n in names) and not redo)
            if kept and "shift" in had[0]:
                s["img"][ch], s["disk"]["img"][ch] = had
                continue
            if not wanted:
                if kept:
                    s["img"][ch], s["disk"]["img"][ch] = had
                continue
            try:
                shift = limb_offset(screenshot(mid, layer, 0, 0, CHECK[1], CHECK[0]), rsun) or (0.0, 0.0)
            except Exception as e:
                print(f"  {key} {ch}: pointing check failed ({e})", flush=True)
                FAILED.append(f"{key} {ch} pointing check")
                if kept:
                    s["img"][ch], s["disk"]["img"][ch] = had
                continue
            off = math.hypot(*shift) > CHECK_TOL
            if kept and not off:
                # Images already on disk and well pointed: only record the check
                s["img"][ch], s["disk"]["img"][ch] = ({**h, "shift": [0.0, 0.0]} for h in had)
                continue
            dx, dy = shift if off else (0.0, 0.0)
            dsc = s["disk"]["scale"]
            t, png = fetch(OUT / names[1], mid, layer, source, mode, dx, dy, dsc, DISK)
            if t and off:
                # The finer full-disk image pins the offset down further
                fine = limb_offset(png, rsun, (DISK, dsc))
                if fine and math.hypot(*fine) > 2 * dsc:
                    dx, dy = round(dx + fine[0], 1), round(dy + fine[1], 1)
                    t, png = fetch(OUT / names[1], mid, layer, source, mode, dx, dy, dsc, DISK)
            if t:
                s["disk"]["img"][ch] = {"file": names[1], "date": t, "shift": [dx, dy]}
            t, _ = fetch(OUT / names[0], mid, layer, source, mode, x0 + dx, y0 + dy, scale, SIZE)
            if t:
                s["img"][ch] = {"file": names[0], "date": t, "shift": [dx, dy]}
            print(f"  {key} {ch}: {s['img'].get(ch, {}).get('date')}" + (f", disk centre off by ({dx:+.0f}, {dy:+.0f}) arcsec, corrected" if off else ""), flush=True)
        sets.append(s)
    # Cutouts of runs that no longer exist, or of an older layout
    keep = {i["file"] for st in sets for v in (st, st["disk"]) for i in v["img"].values()}
    for f in OUT.glob("*.jpg"):
        if f.name not in keep:
            f.unlink()
    idx_path.write_text(json.dumps({
        "source": "SDO/AIA and SDO/HMI cutouts from the Helioviewer API (https://api.helioviewer.org/)",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "channels": list(CHANNELS),
        "sets": sets,
    }, indent=1))
    done = sum(len(v["img"]) for st in sets for v in (st, st["disk"]))
    size = sum(f.stat().st_size for f in OUT.glob("*.jpg")) / 1e6
    print(f"{len(sets)} runs, {done} of {6 * len(sets)} images ({size:.1f} MB)")


FAILED = []  # images that could not be fetched; the run then exits with an error

if __name__ == "__main__":
    main()
    if FAILED:
        # The index and every other image are written; the error lets the workflow report the gap
        sys.exit(f"could not fetch {len(FAILED)} images: {', '.join(FAILED[:10])}")
