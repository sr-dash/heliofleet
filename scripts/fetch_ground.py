#!/usr/bin/env python3
"""Collect DKIST/Cryo-NIRSP observation footprints for HelioFleet's sky view.

Reads the dataset inventory published by the Cryo-NIRSP viewer
(https://sr-dash.github.io/cryonirsp-viewer/) and keeps, for each active
dataset, its time range, waveband, mode, proposal and field-of-view outline in
helioprojective arcseconds. Writes data/ground/cryonirsp.json.

Usage:  python scripts/fetch_ground.py [path-or-url to cryonirsp_dataset_details.json]
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "ground" / "cryonirsp.json"
SOURCE = "https://sr-dash.github.io/cryonirsp-viewer/data/cryonirsp_dataset_details.json"


def load(src):
    if src.startswith("http"):
        with urllib.request.urlopen(src, timeout=120) as r:
            return json.load(r)
    return json.loads(Path(src).read_text())


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE
    inv = load(src)
    out = []
    for d in inv["datasets"].values():
        if d.get("dataset_status") != "ACTIVE" or not d.get("spatial_bounds_arcsec"):
            continue
        xs, ys = d["spatial_bounds_arcsec"]
        out.append({
            "id": d["dataset_id"],
            "t0": d["start_time"][:19] + "Z",
            "t1": d["end_time"][:19] + "Z",
            "wave": d.get("waveband") or "",
            "mode": d.get("mode_key") or "",
            "pid": d.get("proposal_id") or "",
            "rsun": round(d.get("solar_radius_arcsec") or 960.0, 2),
            "x": [round(v, 1) for v in xs],
            "y": [round(v, 1) for v in ys],
        })
    out.sort(key=lambda e: e["t0"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Cryo-NIRSP viewer inventory (https://sr-dash.github.io/cryonirsp-viewer/), from the DKIST data center",
        "inventory_generated": inv.get("generated_at"),
        "datasets": out,
    }, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} datasets, {out[0]['t0'][:10]} to {out[-1]['t0'][:10]}")


if __name__ == "__main__":
    main()
