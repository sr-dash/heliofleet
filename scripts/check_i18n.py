#!/usr/bin/env python3
"""List the English interface strings and check the translation files.

Collects every string the page can show: visible text and attributes in
index.html, literals passed to tr() in js/, and catalogue text that the page
translates at load (body names, eclipse and milestone labels, preset titles,
alignment help, storm and event-kind labels). Then reports, for each
i18n/<lang>.json, which strings are missing and which entries are unused.

Usage:  python scripts/check_i18n.py            # report
        python scripts/check_i18n.py --keys     # print all English strings
"""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ATTRS = {"title", "aria-label", "placeholder", "alt"}
SKIP_TEXT = re.compile(r"^[\d\s.,:+\-−±×°/()]*(au|d|h|CR|fps|km/s)?[\d\s.,:+\-−±×°/()]*$")
# Proper nouns, units and codes that stay as they are in every language
KEEP = {"HelioFleet", "HelioFleet ↗", "JPL Horizons", "Soumyaranjan Dash", "Dr. Soumyaranjan Dash",
        "CSV", "JSON", "GIF", "μ", "r", "au", "H-alpha", "E", "W"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.keys, self.body, self.title = [], set(), False, False
        self.html_block = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "body":
            self.body = True
        if tag == "title":
            self.title = True
        self.stack.append((tag, "data-i18n-html" in a))
        if "data-i18n-html" in a:
            self.keys.add(f"html:{a['data-i18n-html']}")
        if self.body:
            for k, v in attrs:
                if k in ATTRS and v:
                    self.keys.add(v)

    def handle_endtag(self, tag):
        if tag == "title":
            self.title = False
        while self.stack and self.stack.pop()[0] != tag:
            pass

    def handle_data(self, data):
        text = re.sub(r"\s+", " ", data).strip()
        if self.title and text:
            self.keys.add(text)
        if not self.body or not text or not re.search(r"[A-Za-z]", text):
            return
        tags = [t for t, _ in self.stack]
        if any(t in ("script", "style", "code", "noscript") for t in tags):
            return
        if any(h for _, h in self.stack):
            return
        self.keys.add(text)


def js_keys():
    keys = set()
    for f in (ROOT / "js").glob("*.js"):
        src = f.read_text()
        keys |= set(re.findall(r"\btr\(\s*'((?:[^'\\]|\\.)*)'", src))
        keys |= set(re.findall(r"\btr\(\s*`([^`$]*)`", src))
        for _, a, b in re.findall(r"\btr\(([^()]*?)\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'", src):
            keys |= {a, b}
    return {k.replace("\\'", "'") for k in keys}


def catalogue_keys():
    keys = set()
    cat = (ROOT / "js" / "catalog.js").read_text()
    for m in re.finditer(r"(?:label|where|note|title): '([^']+)'", cat):
        keys.add(m.group(1))
    for name in ("Earth", "Mercury", "Venus", "Mars"):
        keys.add(name)
    tools = (ROOT / "js" / "tools.js").read_text()
    block = tools[tools.index("export const ALIGN_KINDS"):tools.index("export async function findAlignments")]
    keys |= set(re.findall(r"(?:label|help): '([^']+)'", block))
    keys |= {"on disk", "near limb", "just behind limb", "far side"}
    ev = (ROOT / "js" / "events.js").read_text()
    keys |= set(re.findall(r"\d: '([^']+)'", ev))
    keys |= set(re.findall(r"^\s+\w+: '([^']+)',$", ev[ev.index("KIND_LABEL"):], re.M))
    return keys


def all_keys():
    page = Page()
    page.feed((ROOT / "index.html").read_text())
    keys = page.keys | js_keys() | catalogue_keys()
    return sorted(k for k in keys if k not in KEEP and not SKIP_TEXT.match(k))


def main():
    keys = all_keys()
    if "--keys" in sys.argv:
        print("\n".join(keys))
        return
    ok = True
    for f in sorted((ROOT / "i18n").glob("*.json")):
        d = json.loads(f.read_text())
        missing = [k for k in keys if k not in d]
        unused = [k for k in d if k not in keys]
        bad = [k for k in d if set(re.findall(r"\{(\w+)\}", k)) != set(re.findall(r"\{(\w+)\}", d[k]))]
        print(f"{f.name}: {len(d)} entries, {len(missing)} missing, {len(unused)} unused, {len(bad)} placeholder mismatches")
        for k in missing:
            print(f"  missing: {k}")
        for k in bad:
            print(f"  placeholders differ: {k}")
        ok &= not missing and not bad
    print(f"{len(keys)} English strings")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
