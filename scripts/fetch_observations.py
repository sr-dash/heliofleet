#!/usr/bin/env python3
"""Collect observation footprints of high-resolution solar instruments.

For each observation it keeps the time range, the field of view as a polygon in
helioprojective arcseconds, an identifier, a short description and a link, and
writes them by year to data/obs/<year>.json for the sky view. Sources:

  IRIS            LMSAL Heliophysics Coverage Registry (raster and slit-jaw fields)
  Hinode/EIS      the EIS as-run catalogue (eis_cat.sqlite, as used by EISPAC)
  DKIST           the DKIST Data Center dataset API (every instrument except
                  Cryo-NIRSP, which comes from the Cryo-NIRSP viewer)
  Solar Orbiter   SOAR metadata of EUI-HRI, PHI-HRT and SPICE level-2 files,
                  grouped by pointing; these fields are in Solar Orbiter's own
                  helioprojective frame, with the observer position kept so the
                  page can carry them over to Earth's view

Usage:
  python scripts/fetch_observations.py                      # the last twelve months (late releases)
  python scripts/fetch_observations.py --from 2024-03 --to 2024-03
  python scripts/fetch_observations.py --all                # everything since 2010
  python scripts/fetch_observations.py --only iris,dkist    # some sources only
  python scripts/fetch_observations.py --threads 8          # parallel Solar Orbiter days (default 4)
  python scripts/fetch_observations.py --index              # only rebuild the index and coordinated list

Every run also rebuilds data/obs/coordinated.json: groups of observations by
different facilities (DKIST, IRIS, Hinode/EIS, Solar Orbiter) that overlap in
time and on the Sun as seen from Earth, for the page's coordinated-dataset finder.
Standard library only.
"""

import json
import math
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "obs"
HCR = "https://www.lmsal.com/hek/hcr"
DKIST = "https://api.dkistdc.nso.edu/datasets/v1"
SOAR = "https://soar.esac.esa.int/soar-sl-tap/tap/sync"
EIS_CAT = "https://hesperia.gsfc.nasa.gov/ssw/hinode/eis/database/catalog/eis_cat.sqlite"
CACHE = ROOT / ".cache"
AU_M = 149597870700.0
START = {"iris": date(2013, 7, 1), "eis": date(2010, 1, 1), "dkist": date(2021, 1, 1), "solo": date(2020, 2, 1)}


def get(url, tries=4, timeout=300):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(10 * (attempt + 1))


def iso(s):
    """'2024-03-23 14:19:28' or '2024-03-23T14:19:28.123' -> '2024-03-23T14:19:28Z'."""
    return s.replace(" ", "T")[:19] + "Z"


def box(xc, yc, w, h, roll=0.0):
    """Closed polygon of a w x h field centred on (xc, yc), rotated by roll degrees (counter-clockwise)."""
    c, s = math.cos(math.radians(roll)), math.sin(math.radians(roll))
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]
    return ([round(xc + c * x - s * y, 1) for x, y in pts], [round(yc + s * x + c * y, 1) for x, y in pts])


def months(a, b):
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield date(y, m, 1)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def month_end(m):
    return date(m.year + (m.month == 12), m.month % 12 + 1, 1)


# ---------- IRIS ----------
def iris(m0, m1):
    rows = []
    for m in months(m0, m1):
        q = urllib.parse.urlencode({
            "cmd": "search-events3", "outputformat": "json", "instrument": "IRIS",
            "startTime": f"{m}T00:00", "stopTime": f"{month_end(m)}T00:00", "hasData": "true", "limit": 5000})
        try:
            # The registry's text is not always valid UTF-8
            events = json.loads(get(f"{HCR}?{q}").decode("utf-8", "replace")).get("Events", [])
        except Exception as e:
            print(f"  IRIS {m:%Y-%m}: failed ({e})", flush=True)
            FAILED.append(f"IRIS {m:%Y-%m}")
            continue
        for e in events:
            if e.get("xCen") is None or e.get("raster_fovx") is None or not e.get("startTime") or not e.get("stopTime"):
                continue
            roll = float(e.get("roll_angle") or 0)
            x, y = box(e["xCen"], e["yCen"], max(float(e["raster_fovx"]), 0.33), float(e["raster_fovy"]), roll)
            sx, sy = box(e["xCen"], e["yCen"], float(e.get("sji_fovx") or 0), float(e.get("sji_fovy") or 0), roll)
            rows.append({
                "i": "iris", "t0": iso(e["startTime"]), "t1": iso(e["stopTime"]), "f": "E", "x": x, "y": y,
                "sx": sx, "sy": sy, "id": str(e.get("iris_obsshort") or e.get("obsId")),
                "n": (e.get("obsTitle") or "").strip()[:80] + (f" · {e['goal'][:70]}" if e.get("goal") else ""),
                "u": e.get("parentUrl")})
        print(f"  IRIS {m:%Y-%m}: {sum(r['t0'][:7] == f'{m:%Y-%m}' for r in rows)}", flush=True)
    return rows


# ---------- Hinode/EIS ----------
def eis(m0, m1):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / "eis_cat.sqlite"
    if not path.exists() or time.time() - path.stat().st_mtime > 86400:
        print("  downloading the EIS catalogue", flush=True)
        path.write_bytes(get(EIS_CAT, timeout=1800))
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    # Catalogue times are TAI seconds since 1958; TAI - UTC is 34-37 s over the mission
    t58 = lambda d: (datetime.combine(d, datetime.min.time()) - datetime(1958, 1, 1)).total_seconds() + 37
    utc = lambda t: (datetime(1958, 1, 1) + timedelta(seconds=t - 37)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    cur = None
    for r in db.execute(EIS_QUERY, (t58(m0), t58(month_end(m1)))):
        if r["xcen"] is None or not r["fovx"] or not r["date_obs"]:
            continue
        key = (r["tl_id"], round(r["xcen"]), round(r["ycen"]), r["fovx"], r["fovy"])
        # Repeats of one study at one pointing make a single observation
        if cur and cur["key"] == key and r["date_obs"] - cur["t1"] < 1800:
            cur["t1"], cur["k"] = max(cur["t1"], r["date_end"] or r["date_obs"]), cur["k"] + 1
            continue
        cur = {"key": key, "r": r, "t0": r["date_obs"], "t1": r["date_end"] or r["date_obs"], "k": 1}
        rows.append(cur)
    out = []
    for c in rows:
        r = c["r"]
        x, y = box(r["xcen"], r["ycen"], r["fovx"], r["fovy"])
        title = " ".join((r["obstitle"] or "").replace("&", " ").split())
        out.append({
            "i": "eis", "t0": utc(c["t0"]), "t1": utc(c["t1"]), "f": "E", "x": x, "y": y,
            "id": f"{r['tl_id']}-{utc(c['t0'])[:16].replace('-', '').replace(':', '')}",
            "n": " · ".join(v for v in (r["stud_acr"], title, f"{c['k']} rasters" if c["k"] > 1 else "") if v)[:140]})
    print(f"  EIS {m0:%Y-%m} to {m1:%Y-%m}: {len(out)}", flush=True)
    return out


EIS_QUERY = """
SELECT e.date_obs, e.date_end, e.xcen, e.ycen, e.fovx, e.fovy, e.tl_id, m.stud_acr, m.obstitle
FROM eis_experiment e JOIN eis_main m ON m.tl_id = e.tl_id
WHERE e.date_obs >= ? AND e.date_obs < ? ORDER BY e.date_obs
"""


# ---------- DKIST ----------
def dkist(m0, m1):
    a, b = f"{m0}T00:00:00", f"{month_end(m1)}T00:00:00"
    rows, page = [], 1
    while True:
        q = urllib.parse.urlencode({"startTimeMin": a, "startTimeMax": b, "pageSize": 1000, "pageNumber": page})
        res = json.loads(get(f"{DKIST}?{q}"))["searchResults"]
        for d in res:
            if d.get("instrumentName") == "CRYO-NIRSP" or not d.get("boundingBox") or d.get("status") != "ACTIVE":
                continue
            (x1, y1), (x2, y2) = [tuple(map(float, p.strip("()").split(","))) for p in d["boundingBox"].split("),(")]
            x, y = box((x1 + x2) / 2, (y1 + y2) / 2, abs(x1 - x2), abs(y1 - y2))
            lines = ", ".join(d.get("spectralLines") or [])
            rows.append({
                "i": d["instrumentName"].lower().replace("-", ""), "t0": iso(d["startTime"]), "t1": iso(d["endTime"]),
                "f": "E", "x": x, "y": y, "id": d["datasetId"],
                "n": " · ".join(v for v in (lines, d.get("primaryProposalId")) if v),
                "u": d.get("browseMovieUrl")})
        if len(res) < 1000:
            break
        page += 1
    print(f"  DKIST {m0:%Y-%m} to {m1:%Y-%m}: {len(rows)}", flush=True)
    return rows


# ---------- Solar Orbiter ----------
SOLO = {
    # table, instrument key per detector, detectors kept
    "eui": ("soar.v_eui_sc_fits", {"HRI_EUV": "euihri", "HRI_LYA": "euilya"}),
    "phi": ("soar.v_phi_sc_fits", {"HRT": "phihrt"}),
    "spice": ("soar.v_spi_sc_fits", {None: "spice"}),
}


def tap(query):
    q = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query})
    d = json.loads(get(f"{SOAR}?{q}"))
    cols = [c["name"] for c in d["metadata"]]
    return [dict(zip(cols, r)) for r in d["data"]]


def solo_day(day):
    """Level-2 EUI-HRI, PHI-HRT and SPICE files of one day, one row per pointing."""
    a, b = f"{day}", f"{day + timedelta(days=1)}"
    rows = []
    for table, dets in SOLO.values():
        det = "detector, " if None not in dets else ""
        where = f"AND detector IN ({','.join(repr(k) for k in dets)})" if None not in dets else ""
        groups = tap(f"""
            SELECT {det}soop_name, dimension_index, cr_pix1, cr_pix2, ROUND(cr_val1, 0) AS cx, ROUND(cr_val2, 0) AS cy,
                   MIN(date_begin) AS t0, MAX(date_end) AS t1, COUNT(*) AS n, MAX(num_pixels_per_axis) AS npx,
                   AVG(cr_val1) AS v1, AVG(cr_val2) AS v2, AVG(c_delt1) AS d1, AVG(c_delt2) AS d2,
                   AVG(pc1_1) AS p11, AVG(pc1_2) AS p12, AVG(pc2_1) AS p21, AVG(pc2_2) AS p22,
                   AVG(hg_longitud_obsv) AS lon, AVG(hg_latitude_obsv) AS lat, AVG(distance_sun_obsv) AS dist
            FROM {table} WHERE "level" = 'L2' {where} AND dimension_index IN (1, 2)
              AND date_begin >= '{a}' AND date_begin < '{b}'
            GROUP BY {det}soop_name, dimension_index, cr_pix1, cr_pix2, cx, cy""")
        pair = {}
        for g in groups:
            k = (g.get("detector"), g["soop_name"], g["cr_pix1"], g["cr_pix2"], g["cx"], g["cy"])
            pair.setdefault(k, {})[g["dimension_index"]] = g
        for k, p in pair.items():
            if 1 not in p or 2 not in p or p[1]["lon"] is None:
                continue
            g, nx, ny = p[1], p[1]["npx"], p[2]["npx"]
            # Corners of the pixel grid through the linear WCS
            xs, ys = [], []
            for i, j in ((0.5, 0.5), (nx + 0.5, 0.5), (nx + 0.5, ny + 0.5), (0.5, ny + 0.5), (0.5, 0.5)):
                u, v = i - g["cr_pix1"], j - g["cr_pix2"]
                xs.append(round(g["v1"] + g["d1"] * (g["p11"] * u + g["p12"] * v), 1))
                ys.append(round(g["v2"] + g["d2"] * (g["p21"] * u + g["p22"] * v), 1))
            inst = dets[k[0]]
            rows.append({
                "i": inst, "t0": iso(g["t0"]), "t1": iso(g["t1"]), "f": "S", "x": xs, "y": ys,
                "o": [round(g["lon"], 3), round(g["lat"], 3), round(g["dist"] / AU_M, 5)],
                "id": f"{inst}-{g['t0'][:19].replace('-', '').replace(':', '')}",
                "n": "" if (g["soop_name"] or "none").strip() == "none" else g["soop_name"].strip(), "k": g["n"]})
    return rows


def solo(m0, m1):
    days = [m0 + timedelta(days=k) for k in range((month_end(m1) - m0).days)]
    rows = []
    with ThreadPoolExecutor(THREADS) as pool:
        for day, got in zip(days, pool.map(solo_day, days)):
            rows += got
    rows = merge(rows)
    print(f"  Solar Orbiter {m0:%Y-%m} to {m1:%Y-%m}: {len(rows)}", flush=True)
    return rows


def merge(rows, tol=30.0, gap=1800):
    """Joins observations of one instrument at the same pointing (within tol arcsec)
    that follow each other within gap seconds; "k" counts the files joined."""
    t = lambda s: datetime.fromisoformat(s[:19]).timestamp()
    out, open_ = [], {}
    for r in sorted(rows, key=lambda r: r["t0"]):
        cx, cy = sum(r["x"][:4]) / 4, sum(r["y"][:4]) / 4
        w = max(r["x"]) - min(r["x"])
        prev = [o for o in open_.get(r["i"], [])
                if t(r["t0"]) - t(o["t1"]) < gap and math.hypot(o["_c"][0] - cx, o["_c"][1] - cy) < tol
                and abs(o["_w"] - w) < tol and o["n"] == r["n"]]
        if prev:
            o = prev[0]
            o["t1"] = max(o["t1"], r["t1"])
            o["k"] = o.get("k", 1) + r.get("k", 1)
            continue
        r = {**r, "_c": (cx, cy), "_w": w}
        open_.setdefault(r["i"], []).append(r)
        open_[r["i"]] = [o for o in open_[r["i"]] if t(r["t0"]) - t(o["t1"]) < gap]
        out.append(r)
    for r in out:
        r.pop("_c"), r.pop("_w")
        if "k" in r:
            r["n"] = " · ".join(v for v in (r["n"], f"{r['k']} file{'s' if r['k'] != 1 else ''}") if v)
            del r["k"]
    return out


THREADS = 4
FAILED = []  # sources or months that could not be fetched; the run then exits with an error
SOURCES = {"iris": iris, "eis": eis, "dkist": dkist, "solo": solo}
INSTS = {"iris": {"iris"}, "eis": {"eis"}, "dkist": None, "solo": {"euihri", "euilya", "phihrt", "spice"}}


def main():
    args = sys.argv[1:]
    opt = lambda k: args[args.index(k) + 1] if k in args else None
    today = datetime.now(timezone.utc).date()
    if "--all" in args:
        m0 = date(2010, 1, 1)
    else:
        f = opt("--from")
        m0 = date(*map(int, f.split("-")), 1) if f else date(today.year, today.month, 1) - timedelta(days=334)
    t = opt("--to")
    m1 = date(*map(int, t.split("-")), 1) if t else date(today.year, today.month, 1)
    m0 = m0.replace(day=1)
    only = (opt("--only") or ",".join(SOURCES)).split(",")
    global THREADS
    THREADS = int(opt("--threads") or THREADS)
    OUT.mkdir(parents=True, exist_ok=True)
    if "--index" in args:
        return write_index()
    fresh = {}
    for name in only:
        a = max(m0, START[name])
        if a > m1:
            continue
        try:
            fresh[name] = SOURCES[name](a, m1)
        except Exception as e:
            print(f"  {name}: failed ({e}); its earlier rows are kept", flush=True)
            FAILED.append(name)
    # Replace each refetched source's rows in the refetched months, one file per month
    others = {i for n, ins in INSTS.items() if ins for i in ins}
    def mine(r):
        return any((INSTS[n] is None and r["i"] not in others) or (INSTS[n] and r["i"] in INSTS[n]) for n in fresh)
    new = [r for rs in fresh.values() for r in rs]
    for m in months(m0, m1):
        key = f"{m:%Y-%m}"
        path = OUT / f"{key}.json"
        old = json.loads(path.read_text())["rows"] if path.exists() else []
        rows = [r for r in old if not mine(r)] + [r for r in new if r["t0"][:7] == key]
        if not rows:
            continue
        rows.sort(key=lambda r: (r["t0"], r["i"]))
        path.write_text(json.dumps({"rows": rows}, separators=(",", ":")))
    write_index()


def write_index():
    """The page reads this list first, to know which months have files."""
    index = {}
    for f in sorted(OUT.glob("????-??.json")):
        try:
            rows = json.loads(f.read_text())["rows"]
        except ValueError:
            continue  # being written by a parallel run; the next index pass counts it
        index[f.stem] = {k: sum(r["i"] == k for r in rows) for k in sorted({r["i"] for r in rows})}
    coordinated()
    (OUT / "index.json").write_text(json.dumps({
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {"iris": "LMSAL Heliophysics Coverage Registry", "eis": "Hinode/EIS as-run catalogue",
                    "dkist": "DKIST Data Center dataset API", "solo": "Solar Orbiter Archive (SOAR) level-2 metadata"},
        "months": index}, indent=1))
    size = sum(f.stat().st_size for f in OUT.glob("*.json")) / 1e6
    print(f"{len(index)} months of observations in {OUT.relative_to(ROOT)} ({size:.1f} MB)")



# ---------- coordinated observations ----------
GROUP = {"iris": "iris", "eis": "eis", "euihri": "solo", "euilya": "solo", "phihrt": "solo", "spice": "solo"}
R_SUN_AU = 695700 / 149597870.7
ARC = math.pi / 648000


def earth_view(jd):
    """Earth's heliographic latitude (degrees) and distance (au), after Meeus."""
    T = (jd - 2451545) / 36525
    M = math.radians(357.52911 + 35999.05029 * T)
    lon = 280.46646 + 36000.76983 * T + (1.914602 - 0.004817 * T) * math.sin(M) + 0.019993 * math.sin(2 * M)
    node = 73.6667 + 1.3958333 * (jd - 2396758) / 36525
    b0 = math.degrees(math.asin(math.sin(math.radians(lon - node)) * math.sin(math.radians(7.25))))
    return 0.0, b0, 1.000140 - 0.016708 * math.cos(M) - 0.000139 * math.cos(2 * M)


def axes(lon, lat, d):
    lo, la = math.radians(lon), math.radians(lat)
    o = [d * math.cos(la) * math.cos(lo), d * math.cos(la) * math.sin(lo), d * math.sin(la)]
    s = [-v / d for v in o]
    n = [-s[2] * s[0], -s[2] * s[1], 1 - s[2] * s[2]]
    nn = math.hypot(*n)
    n = [v / nn for v in n]
    w = [s[1] * n[2] - s[2] * n[1], s[2] * n[0] - s[0] * n[2], s[0] * n[1] - s[1] * n[0]]
    return o, s, n, w


def carry(tx, ty, frm, to):
    """The same construction as js/observations.js: through the solar surface, or
    where the line of sight passes closest to Sun centre."""
    o, s, n, w = frm
    a, b = tx * ARC, ty * ARC
    d = [math.cos(b) * math.cos(a) * s[k] + math.cos(b) * math.sin(a) * w[k] + math.sin(b) * n[k] for k in range(3)]
    od = sum(o[k] * d[k] for k in range(3))
    disc = od * od - (sum(v * v for v in o) - R_SUN_AU ** 2)
    t = -od - math.sqrt(disc) if disc >= 0 else -od
    p = [o[k] + t * d[k] for k in range(3)]
    eo, es, en, ew = to
    v = [p[k] - eo[k] for k in range(3)]
    r = math.hypot(*v)
    dot = lambda x, y: sum(x[k] * y[k] for k in range(3))
    return math.atan2(dot(v, ew), dot(v, es)) / ARC, math.asin(dot(v, en) / r) / ARC


def jd_of(iso_):
    return datetime.fromisoformat(iso_[:19]).replace(tzinfo=timezone.utc).timestamp() / 86400 + 2440587.5


def earth_box(r, j):
    """Bounding box of a footprint in Earth's helioprojective frame."""
    if r.get("f") != "S":
        return min(r["x"]), min(r["y"]), max(r["x"]), max(r["y"])
    frm, to = axes(*r["o"]), axes(*earth_view(j))
    pts = []
    for i in range(len(r["x"]) - 1):
        for u in (0, 0.5):
            pts.append(carry(r["x"][i] + (r["x"][i + 1] - r["x"][i]) * u, r["y"][i] + (r["y"][i + 1] - r["y"][i]) * u, frm, to))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def coordinated():
    """Observations by different facilities overlapping in time and in Earth's view,
    joined into groups (one group per shared target and stretch of time)."""
    obs = []
    for f in sorted(OUT.glob("????-??.json")):
        try:
            obs += json.loads(f.read_text())["rows"]
        except ValueError:
            continue
    cryo = ROOT / "data" / "ground" / "cryonirsp.json"
    if cryo.exists():
        for d in json.loads(cryo.read_text())["datasets"]:
            obs.append({"i": "cryonirsp", "t0": d["t0"], "t1": d["t1"], "f": "E", "x": d["x"], "y": d["y"], "id": d["id"]})
    items = []
    for r in obs:
        try:
            j0, j1 = jd_of(r["t0"]), jd_of(r["t1"])
        except ValueError:
            continue  # an impossible date in the source record
        if j1 < j0:
            continue
        # Longer than a day comes from faulty catalogue entries (the page cuts these too)
        j1 = min(j1, j0 + 1)
        g = GROUP.get(r["i"], "dkist")
        items.append((j0, j1, g, r["i"], r["id"], earth_box(r, (j0 + j1) / 2)))
    items.sort()
    parent = list(range(len(items)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    active = []
    for k, (j0, j1, g, *_rest, b) in enumerate(items):
        active = [m for m in active if items[m][1] >= j0]
        for m in active:
            o = items[m]
            if o[2] != g and o[5][0] <= b[2] and b[0] <= o[5][2] and o[5][1] <= b[3] and b[1] <= o[5][3]:
                parent[find(k)] = find(m)
        active.append(k)
    comps = {}
    for k in range(len(items)):
        comps.setdefault(find(k), []).append(k)
    out = []
    for ks in comps.values():
        groups = sorted({items[k][2] for k in ks})
        if len(groups) < 2:
            continue
        j0 = min(items[k][0] for k in ks)
        j1 = max(items[k][1] for k in ks)
        cx = sum((items[k][5][0] + items[k][5][2]) / 2 for k in ks) / len(ks)
        cy = sum((items[k][5][1] + items[k][5][3]) / 2 for k in ks) / len(ks)
        rsun = 959.63 / earth_view((j0 + j1) / 2)[2]
        count = {}
        for k in ks:
            count[items[k][3]] = count.get(items[k][3], 0) + 1
        # The member to open: the rarest facility's first observation
        rare = min(groups, key=lambda g: sum(items[k][2] == g for k in ks))
        first = min((k for k in ks if items[k][2] == rare), key=lambda k: items[k][0])
        out.append([
            (datetime(1970, 1, 1) + timedelta(days=j0 - 2440587.5)).strftime("%Y-%m-%dT%H:%MZ"),
            round((j1 - j0) * 24, 2), round(cx), round(cy), round(math.hypot(cx, cy) / rsun, 2),
            "+".join(groups), count, items[first][4],
            (datetime(1970, 1, 1) + timedelta(days=(items[first][0] + items[first][1]) / 2 - 2440587.5)).strftime("%Y-%m-%dT%H:%MZ")])
    out.sort()
    (OUT / "coordinated.json").write_text(json.dumps({
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "columns": ["start", "hours", "x", "y", "r_over_rsun", "facilities", "observations", "open", "open_mid"],
        "rows": out}, separators=(",", ":")))
    print(f"{len(out)} coordinated groups in {OUT.relative_to(ROOT)}/coordinated.json")


if __name__ == "__main__":
    main()
    if FAILED:
        # Everything else is written; the error lets the workflow report the gap
        sys.exit(f"could not fetch: {', '.join(FAILED)}")
