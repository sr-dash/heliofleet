#!/usr/bin/env python3
"""Redraw a HelioFleet map from the files saved with it.

Reads positions.csv, trails.csv, orbits.csv, spirals.csv and settings.json
from the folder this script is in (or --data), and draws the Sun, the planet
orbits, the spacecraft with their trails and, if they were on, the Parker
spirals, in the frame and view of the page. It leaves out the page's
annotations (the coordinate table, fields of view, CME fronts, the inset), so
the figure is a clean starting point to edit for a paper or a talk.

Writes <out>.png and <out>.pdf. Run with --help for the options.

Requirements: Python 3.9+, NumPy, Matplotlib.
Part of HelioFleet, https://sr-dash.github.io/heliofleet/ (MIT licence).
"""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

R_SUN_AU = 695700.0 / 149597870.7


# ------------------------------------------------------------------ reading
def read_csv(path):
    """Rows of a HelioFleet CSV as dicts; lines starting with # are notes."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def xyz(row):
    return np.array([float(row["x_au"]), float(row["y_au"]), float(row["z_au"])])


def paths(rows):
    """Group rows into one (n, 3) array per body, in file order."""
    out = defaultdict(list)
    for r in rows:
        out[r["key"]].append(xyz(r))
    return {k: np.array(v) for k, v in out.items()}


def trail_paths(rows):
    """(past, future) arrays per body. Both include the chosen moment, so the
    two halves meet at the spacecraft."""
    out = defaultdict(lambda: ([], []))
    for r in rows:
        out[r["key"]][r["segment"] == "future"].append(xyz(r))
    return {k: (np.array(p), np.array(f)) for k, (p, f) in out.items()}


def project(p, frame, view):
    """Frame vectors (..., 3) to plot axes (right, up), as on the page.

    Top view, HEE: Earth at the bottom, its direction of motion to the right.
    Top view, inertial: x to the right, y up. Side view: x right, north up.
    """
    p = np.atleast_2d(p)
    if view == "side":
        return p[:, 0], p[:, 2]
    if frame == "hee":
        return p[:, 1], -p[:, 0]
    return p[:, 0], p[:, 1]


# ------------------------------------------------------------------ drawing
def nice_step(span):
    raw = span / 4
    mag = 10 ** np.floor(np.log10(raw))
    return min((m * mag for m in (1, 2, 2.5, 5, 10)), key=lambda s: abs(s - raw))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", type=Path, default=Path(__file__).resolve().parent, help="folder with the CSV files (default: this script's folder)")
    ap.add_argument("--out", help="output name without extension (default: heliofleet_<time>)")
    ap.add_argument("--range", type=float, help="half-width of the plot in au (default: as on the page)")
    ap.add_argument("--view", choices=["top", "side"], help="top: from ecliptic north; side: edge-on (default: as on the page)")
    ap.add_argument("--light", action="store_true", help="white background and dark ink, for print")
    ap.add_argument("--hide", nargs="*", default=[], metavar="KEY", help="bodies to leave out, by key (see positions.csv)")
    ap.add_argument("--no-trails", action="store_true", help="leave out the trails")
    ap.add_argument("--no-orbits", action="store_true", help="leave out the planet orbits")
    ap.add_argument("--spirals", action=argparse.BooleanOptionalAction, default=None, help="Parker spirals on or off (default: as on the page)")
    ap.add_argument("--no-labels", action="store_true", help="leave out the body names")
    ap.add_argument("--no-grid", action="store_true", help="leave out the distance rings")
    ap.add_argument("--size", type=float, default=6.0, help="figure width and height in inches (default 6)")
    ap.add_argument("--dpi", type=int, default=300, help="PNG resolution (default 300)")
    a = ap.parse_args()

    st = json.loads((a.data / "settings.json").read_text(encoding="utf-8"))
    frame, view = st["frame"], a.view or st["view"]
    rng = a.range or st["range_au"]
    cx, cy = st["center_au"] if not a.range else (0.0, 0.0)
    col = st["colors"]
    if a.light:
        bg, ink, muted, grid, sun = "white", "black", "0.35", "0.85", "#E8A100"
    else:
        bg, ink, muted, grid, sun = col["background"], col["ink"], col["muted"], col["grid"], col["sun"]
    spirals_on = st["show_spirals"] if a.spirals is None else a.spirals
    hide = set(a.hide)

    bodies = [r for r in read_csv(a.data / "positions.csv") if r["key"] not in hide]
    color = {r["key"]: r["color"] for r in bodies}
    if a.light:  # page colours made for a dark background can be too pale on white
        color = {k: matplotlib.colors.to_hex(np.array(matplotlib.colors.to_rgb(c)) * 0.8) for k, c in color.items()}
    trails = trail_paths(read_csv(a.data / "trails.csv"))
    orbits = paths(read_csv(a.data / "orbits.csv"))
    spirals = paths(read_csv(a.data / "spirals.csv"))

    fig, ax = plt.subplots(figsize=(a.size, a.size))
    fig.patch.set_facecolor(bg)
    ax.set_facecolor(bg)
    ax.set_aspect("equal")
    ax.set_xlim(cx - rng, cx + rng)
    ax.set_ylim(cy - rng, cy + rng)

    if not a.no_grid:
        if view == "top":  # distance rings
            step = nice_step(rng * 1.3)
            for r in np.arange(step, rng * 1.5 + abs(cx) + abs(cy), step):
                ax.add_patch(plt.Circle((0, 0), r, fill=False, color=grid, lw=0.6, zorder=0))
                ax.text(r * 0.7071 + 0.01 * rng, r * 0.7071, f"{r:g} au", color=muted, fontsize=7, zorder=0, clip_on=True)
        else:  # the ecliptic plane, edge-on
            ax.axhline(0, color=grid, lw=0.6, zorder=0)

    if not a.no_orbits and view == "top":
        for key, p in orbits.items():
            if key in hide:
                continue
            x, y = project(p, frame, view)
            ax.plot(x, y, color=color.get(key, muted), lw=0.8, alpha=0.4, zorder=1)

    if spirals_on and view == "top":
        for key, p in spirals.items():
            if key in hide or key not in color:
                continue
            x, y = project(p, frame, view)
            ax.plot(x, y, color=color[key], lw=0.8, ls=(0, (4, 3)), alpha=0.5, zorder=1)

    if not a.no_trails:
        for key, p in trails.items():
            if key in hide or key not in color:
                continue
            past, fut = p
            if len(past) > 1:
                x, y = project(past, frame, view)
                ax.plot(x, y, color=color[key], lw=1.2, alpha=0.7, zorder=2)
            if len(fut) > 1:
                x, y = project(fut, frame, view)
                ax.plot(x, y, color=color[key], lw=1.0, ls=(0, (1, 2.5)), alpha=0.7, zorder=2)

    # The Sun at true size if that is visible, otherwise as a dot
    ax.add_patch(plt.Circle((0, 0), max(R_SUN_AU, rng * 0.02), color=sun, zorder=3))

    near = []
    for r in bodies:
        key = r["key"]
        if r["near_earth"] == "1":
            near.append(r["name"])
            continue
        x, y = project(xyz(r), frame, view)
        sc = r["kind"] == "sc"
        lost = r["status"] == "lost"
        ax.plot(x, y, marker="D" if sc else "o", ms=6 if sc else (8 if key == "earth" else 6),
                mfc="none" if lost else color[key], mec=color[key], mew=1.2, ls="none", zorder=4)
        if not a.no_labels:
            name = r["name"] + (" (contact lost)" if lost else " (at Earth)" if r["status"] == "approx" else "")
            ax.annotate(name, (x[0], y[0]), xytext=(6, 5), textcoords="offset points", color=color[key], fontsize=8, zorder=5)
    if near and not a.no_labels:
        e = next((r for r in bodies if r["key"] == "earth"), None)
        if e is not None:
            x, y = project(xyz(e), frame, view)
            ax.annotate("+ " + " · ".join(near), (x[0], y[0]), xytext=(6, -11), textcoords="offset points", color=muted, fontsize=7, zorder=5)

    frame_label = "HEE" if frame == "hee" else "ecliptic J2000"
    ax.set_title(f"{st['time_utc'].replace('T', ' ').replace('Z', ' UTC')}   ({frame_label}, {'top' if view == 'top' else 'side'} view)", color=ink, fontsize=10)
    ax.set_xlabel("au", color=muted, fontsize=8)
    ax.set_ylabel("au", color=muted, fontsize=8)
    ax.tick_params(colors=muted, labelsize=7)
    for s in ax.spines.values():
        s.set_color(grid)

    out = a.out or f"heliofleet_{st['time_utc'][:16].replace('-', '').replace(':', '').replace('T', '_')}UT"
    fig.tight_layout()
    fig.savefig(f"{out}.png", dpi=a.dpi, facecolor=bg)
    fig.savefig(f"{out}.pdf", facecolor=bg)
    print(f"saved {out}.png and {out}.pdf")


if __name__ == "__main__":
    main()
