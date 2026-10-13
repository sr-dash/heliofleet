#!/usr/bin/env python3
"""Check the external links on the site and in its documentation.

Collects every http(s) URL from the pages, the JavaScript modules, the README
and the citation files, and requests each one. A link that is missing (404,
410), failing on the server (5xx) or unreachable is an error. Sites that turn
away automated requests (401, 403, 405, 429) are listed as warnings, since
they usually work in a browser.

Exit status 1 on any error. Usage:  python scripts/check_links.py
"""

import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["index.html", "sky.html", "methods.html", "README.md", "CITATION.cff", ".zenodo.json", *sorted(p.as_posix() for p in Path(ROOT / "js").glob("*.js"))]
URL = re.compile(r"https?://[^\s\"'<>)`\]\\]+")
# Not pages: script and font hosts, analytics, schema identifiers, API bases
SKIP = re.compile(
    r"(fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|schema\.org|cdnjs\.cloudflare|"
    r"\$\{|ssd\.jpl\.nasa\.gov/api|ccmc\.gsfc\.nasa\.gov/DONKI-API|calendar\.google\.com/calendar/render|"
    r"img\.shields\.io|zenodo\.org/badge|localhost)"
)
# 999 is LinkedIn's answer to any automated request
SOFT = {401, 403, 405, 429, 999}
HEADERS = {"User-Agent": "Mozilla/5.0 (HelioFleet link check; https://github.com/sr-dash/heliofleet)"}


def collect():
    urls = {}
    for name in FILES:
        path = Path(name) if Path(name).is_absolute() else ROOT / name
        for u in URL.findall(path.read_text()):
            u = u.rstrip(".,;:")
            if not SKIP.search(u):
                urls.setdefault(u, Path(path).relative_to(ROOT).as_posix())
    return urls


def check(url):
    last = None
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                return url, r.status, None
        except urllib.error.HTTPError as e:
            last = (e.code, None)
            if e.code not in (403, 405, 404, 429, 500, 501, 503):
                break
        except Exception as e:  # DNS, TLS, timeout
            last = (None, str(e)[:120])
    return url, last[0], last[1]


def main():
    urls = collect()
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(check, sorted(urls)))
    errors = warnings = 0
    for url, status, err in results:
        where = urls[url]
        if status and status < 400:
            continue
        if status in SOFT:
            warnings += 1
            print(f"warning: {status} {url} ({where})")
        else:
            errors += 1
            print(f"error: {status or err} {url} ({where})")
    print(f"{len(urls)} links checked: {errors} errors, {warnings} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
