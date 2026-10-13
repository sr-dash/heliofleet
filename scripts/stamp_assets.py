#!/usr/bin/env python3
"""Stamp the page's CSS and JavaScript with content hashes.

GitHub Pages lets browsers cache files for about ten minutes, so right after
an update a visitor could otherwise run a mix of old and new modules. This
script adds ?v=<hash> to the stylesheet and the entry module in index.html,
and writes an import map that gives every module in js/ its own hashed URL,
so a visitor gets either the whole old set or the whole new set.

Run it after changing anything in css/ or js/:
    python3 scripts/stamp_assets.py
    python3 scripts/stamp_assets.py --check   # exit 1 if index.html is stale
"""

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Each page and its entry module
PAGES = {"index.html": "app.js", "sky.html": "sky.js", "methods.html": None}  # methods.html: stylesheet only


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def stamped(page, entry):
    html = (ROOT / page).read_text()
    css = digest(ROOT / "css" / "style.css")
    html = re.sub(r'href="css/style\.css(\?v=[0-9a-f]*)?"', f'href="css/style.css?v={css}"', html)
    if entry is None:
        return html
    modules = sorted((ROOT / "js").glob("*.js"))
    imports = {f"./js/{m.name}": f"./js/{m.name}?v={digest(m)}" for m in modules}
    html = re.sub(rf'src="js/{re.escape(entry)}(\?v=[0-9a-f]*)?"', f'src="{imports["./js/" + entry][2:]}"', html)
    block = ('<!-- assets:start (written by scripts/stamp_assets.py) -->\n'
             f'  <script type="importmap">{json.dumps({"imports": imports}, separators=(",", ":"))}</script>\n'
             '  <!-- assets:end -->')
    if "<!-- assets:start" in html:
        html = re.sub(r"<!-- assets:start.*?<!-- assets:end -->", block, html, flags=re.S)
    else:
        # The import map must come before the first module script
        html = html.replace('  <script type="module"', f"  {block}\n  <script type=\"module\"", 1)
    return html


def main():
    stale = []
    for page, entry in PAGES.items():
        new = stamped(page, entry)
        if new != (ROOT / page).read_text():
            stale.append(page)
            if "--check" not in sys.argv:
                (ROOT / page).write_text(new)
    if "--check" in sys.argv:
        if stale:
            print(f"out of date: {', '.join(stale)}; run python3 scripts/stamp_assets.py")
            sys.exit(1)
        print("asset stamps are current")
        return
    print(f"stamped: {', '.join(stale) or 'nothing changed'}")


if __name__ == "__main__":
    main()
