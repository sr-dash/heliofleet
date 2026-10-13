#!/usr/bin/env python3
"""Build the HelioFleet calendar of upcoming geometry events.

Reads the ephemeris chunks in data/ and writes:
  calendar.ics         an iCalendar feed people can subscribe to
  data/upcoming.json   the same events for the page's "Upcoming" list

Events: perihelia of Parker Solar Probe and Solar Orbiter, radial alignments
of spacecraft (with each other or on the Sun-Earth line), quadratures with
Earth, solar conjunctions (a spacecraft behind the Sun as seen from Earth)
and total solar eclipses from js/catalog.js. Standard library only.
"""

import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = "https://sr-dash.github.io/heliofleet/"
UTC = timezone.utc
JD_UNIX = 2440587.5
STEP = 0.125  # days; Parker moves several degrees per hour near perihelion
LOOKBACK = 30  # days before today that stay in the feed

NAMES = {"earth": "Earth", "psp": "Parker Solar Probe", "solo": "Solar Orbiter",
         "sta": "STEREO-A", "bepi": "BepiColombo"}
PERIHELIA = ["psp", "solo"]
ALIGN_PAIRS = [("psp", "solo"), ("psp", "earth"), ("solo", "earth"), ("psp", "sta"),
               ("solo", "sta"), ("bepi", "earth")]
ALIGN_TOL = 3.0
QUADRATURE = ["psp", "solo", "sta"]
QUAD_TOL = 1.0
CONJUNCTION = ["psp", "solo", "sta", "bepi"]
CONJ_TOL = 2.0


def jd_of(dt):
    return JD_UNIX + dt.timestamp() / 86400


def dt_of(jd):
    return datetime.fromtimestamp((jd - JD_UNIX) * 86400, UTC)


class Series:
    """Uniformly sampled positions of one body, linearly interpolated."""

    def __init__(self, key, info):
        self.step = info["step"]
        chunks = [json.loads((DATA / key / f"{y}.json").read_text()) for y in info["years"]]
        self.t0 = chunks[0]["t0"]
        self.d = []
        for c in chunks:
            self.d += c["d"]
        self.n = len(self.d) // 3
        self.t1 = self.t0 + (self.n - 1) * self.step

    def at(self, jd):
        if jd < self.t0 or jd > self.t1:
            return None
        x = (jd - self.t0) / self.step
        i = min(int(x), self.n - 2)
        u = x - i
        a = self.d[3 * i:3 * i + 3]
        b = self.d[3 * i + 3:3 * i + 6]
        return [a[k] + (b[k] - a[k]) * u for k in range(3)]


def norm(v):
    return math.sqrt(sum(c * c for c in v))


def angle(a, b):
    c = sum(x * y for x, y in zip(a, b)) / (norm(a) * norm(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def windows(times, values, tol):
    """Runs of samples with value <= tol, each with its best (minimum) sample."""
    out, cur = [], None
    for t, v in zip(times, values):
        if v is not None and v <= tol:
            if cur is None:
                cur = {"start": t, "end": t, "best": t, "value": v}
            cur["end"] = t
            if v < cur["value"]:
                cur["best"], cur["value"] = t, v
        elif cur is not None:
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    return out


def link(jd):
    return f"{SITE}?t={dt_of(jd):%Y-%m-%dT%H:%M}Z"


def eclipses():
    text = (ROOT / "js" / "catalog.js").read_text()
    block = text[text.index("export const ECLIPSES"):text.index("];", text.index("export const ECLIPSES"))]
    for m in re.finditer(r"t: '([^']+)', label: '([^']+)', where: '([^']+)'(, hybrid: true)?", block):
        t = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
        yield t, m.group(2), m.group(3), bool(m.group(4))


def build():
    manifest = json.loads((DATA / "manifest.json").read_text())
    bodies = manifest["bodies"]
    series = {k: Series(k, bodies[k]) for k in NAMES}
    now = datetime.now(UTC)
    jd0 = jd_of(now - timedelta(days=LOOKBACK))
    jd1 = manifest["timeline"]["end"]
    times = [jd0 + i * STEP for i in range(int((jd1 - jd0) / STEP) + 1)]
    pos = {k: [s.at(t) for t in times] for k, s in series.items()}
    earth = pos["earth"]
    events = []

    def add(kind, jd, title, detail, keys, jd_end=None):
        events.append({"kind": kind, "t": jd, "end": jd_end, "title": title, "detail": detail, "bodies": keys})

    # Perihelia on each body's own samples: interpolating between samples would
    # cut chords across the curved orbit and invent spurious minima.
    for k in PERIHELIA:
        sr = series[k]
        r = [norm(sr.d[3 * i:3 * i + 3]) for i in range(sr.n)]
        w = max(1, int(20 / sr.step))
        for i in range(1, sr.n - 1):
            t = sr.t0 + i * sr.step
            if t < jd0 or t > jd1 or r[i] != min(r[max(0, i - w):i + w + 1]):
                continue
            den = r[i - 1] - 2 * r[i] + r[i + 1]
            off = 0.5 * (r[i - 1] - r[i + 1]) / den if den else 0.0
            rmin = r[i] - 0.25 * (r[i - 1] - r[i + 1]) * off
            add("perihelion", t + off * sr.step, f"{NAMES[k]} perihelion",
                f"Closest approach to the Sun: {rmin:.4f} au ({rmin * 215.03:.1f} solar radii).", [k])

    for a, b in ALIGN_PAIRS:
        vals = [angle(p, q) if p and q else None for p, q in zip(pos[a], pos[b])]
        for w in windows(times, vals, ALIGN_TOL):
            i = times.index(w["best"])
            if b == "earth":
                ra = norm(pos[a][i])
                title = f"{NAMES[a]} on the Sun–Earth line"
                where = "between the Sun and Earth" if ra < norm(earth[i]) else "beyond Earth"
                detail = f"{NAMES[a]} lies {where}, {w['value']:.1f}° off the Sun–Earth line at {ra:.3f} au."
            else:
                title = f"{NAMES[a]} and {NAMES[b]} radially aligned"
                detail = (f"Sun-centred separation {w['value']:.1f}° at closest; "
                          f"{NAMES[a]} at {norm(pos[a][i]):.3f} au, {NAMES[b]} at {norm(pos[b][i]):.3f} au.")
            detail += f" Within {ALIGN_TOL:.0f}° from {dt_of(w['start']):%Y-%m-%d %H:%M} to {dt_of(w['end']):%Y-%m-%d %H:%M} UTC."
            add("alignment", w["best"], title, detail, [a, b], w["end"])

    for k in QUADRATURE:
        vals = [abs(angle(p, e) - 90) if p and e else None for p, e in zip(pos[k], earth)]
        for w in windows(times, vals, QUAD_TOL):
            i = times.index(w["best"])
            # Earth's direction of motion is z x e; ahead of Earth is the west side.
            ahead = sum(c * d for c, d in zip([-earth[i][1], earth[i][0], 0], pos[k][i])) > 0
            side = "west, ahead of Earth" if ahead else "east, trailing Earth"
            add("quadrature", w["best"], f"{NAMES[k]} in quadrature with Earth",
                f"{NAMES[k]} is 90° from Earth as seen from the Sun ({side}), at {norm(pos[k][i]):.3f} au. "
                "Earth-facing activity appears on its limb.", [k, "earth"], w["end"])

    for k in CONJUNCTION:
        vals = []
        for p, e in zip(pos[k], earth):
            if not p or not e:
                vals.append(None)
                continue
            to_sun = [-c for c in e]
            to_sc = [p[j] - e[j] for j in range(3)]
            behind = norm(to_sc) > norm(e)
            vals.append(angle(to_sun, to_sc) if behind else None)
        for w in windows(times, vals, CONJ_TOL):
            add("conjunction", w["best"], f"Solar conjunction: {NAMES[k]} behind the Sun",
                f"{NAMES[k]} is {w['value']:.2f}° from the Sun's centre as seen from Earth; "
                f"communications are often limited near conjunction. Within {CONJ_TOL:.0f}° from "
                f"{dt_of(w['start']):%Y-%m-%d} to {dt_of(w['end']):%Y-%m-%d}.", [k], w["end"])

    for t, label, where, hybrid in eclipses():
        jd = jd_of(t)
        if jd0 <= jd <= jd1:
            add("eclipse", jd, f"{'Hybrid' if hybrid else 'Total'} solar eclipse: {label}",
                f"Greatest eclipse. Path: {where}.", ["earth"])

    events.sort(key=lambda e: e["t"])
    return events, manifest


def ics_escape(s):
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line):
    out, raw = [], line.encode()
    while len(raw) > 75:
        cut = 75 if not out else 74
        while (raw[cut] & 0xC0) == 0x80:  # do not split a UTF-8 sequence
            cut -= 1
        out.append(raw[:cut].decode())
        raw = raw[cut:]
    out.append(raw.decode())
    return "\r\n ".join(out)


def write_ics(events, generated):
    stamp = generated.strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HelioFleet//sr-dash.github.io//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:HelioFleet",
        "X-WR-CALDESC:Perihelia\\, alignments\\, quadratures\\, solar conjunctions and eclipses for heliophysics spacecraft",
        "X-WR-TIMEZONE:UTC", "REFRESH-INTERVAL;VALUE=DURATION:P7D", "X-PUBLISHED-TTL:P7D",
    ]
    for e in events:
        t = dt_of(e["t"]).replace(second=0, microsecond=0)
        uid = f"{e['kind']}-{'-'.join(e['bodies'])}-{t:%Y%m%d}@sr-dash.github.io"
        url = link(e["t"])
        lines += [
            "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}", f"DTSTART:{t:%Y%m%dT%H%M%SZ}",
            "DURATION:PT1H", f"SUMMARY:{ics_escape(e['title'])}",
            f"DESCRIPTION:{ics_escape(e['detail'] + ' Open in HelioFleet: ' + url)}",
            f"URL:{url}", f"CATEGORIES:{e['kind'].capitalize()}", "TRANSP:TRANSPARENT", "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    (ROOT / "calendar.ics").write_bytes(("\r\n".join(fold(l) for l in lines) + "\r\n").encode())


def main():
    events, _ = build()
    generated = datetime.now(UTC)
    write_ics(events, generated)
    (DATA / "upcoming.json").write_text(json.dumps({
        "generated": generated.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": [{**e, "t": round(e["t"], 5), "end": round(e["end"], 5) if e["end"] else None} for e in events],
    }, separators=(",", ":")))
    kinds = {}
    for e in events:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"calendar.ics and upcoming.json: {len(events)} events {kinds}")


if __name__ == "__main__":
    main()
