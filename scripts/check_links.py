#!/usr/bin/env python3
"""Check the external links on the site and in its documentation.

Collects every http(s) URL from the pages, the JavaScript modules, the README
and the citation files, and requests each one. Only a link that is gone is an
error: 404 or 410, or a host name that no longer resolves. Everything a site
can do to a GitHub runner without the link being broken is a warning: turning
away automated requests (401, 403, 405, 429, LinkedIn's 999), server errors
(5xx), timeouts and refused or reset connections. Those usually work in a
browser, and a warning does not fail the health check.

Exit status 1 on any error. Usage:  python scripts/check_links.py
"""

import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["index.html", "sky.html", "methods.html", "help.html", "llms.txt", "README.md", "CITATION.cff", ".zenodo.json", *sorted(p.as_posix() for p in Path(ROOT / "js").glob("*.js"))]
URL = re.compile(r"https?://[^\s\"'<>)`\]\\]+")
# Not pages: script and font hosts, analytics, schema identifiers, API bases
SKIP = re.compile(
    r"(fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|schema\.org|cdnjs\.cloudflare|"
    r"\$\{|ssd\.jpl\.nasa\.gov/api|ccmc\.gsfc\.nasa\.gov/DONKI-API|calendar\.google\.com/calendar/render|"
    r"img\.shields\.io|zenodo\.org/badge|localhost)"
)
# Gone for good; anything else that fails is a warning
GONE = {404, 410}
DNS = ("Name or service not known", "nodename nor servname", "No address associated", "getaddrinfo failed")
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
    """HEAD, then GET (some servers reject HEAD), then GET once more after a
    timeout or network error."""
    last = None
    for method in ("HEAD", "GET", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return url, r.status, None
        except urllib.error.HTTPError as e:
            last = (e.code, None)
            if method == "GET":
                break
        except Exception as e:  # DNS, TLS, timeout
            last = (None, str(e)[:120])
            if any(m in last[1] for m in DNS):
                break
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
        if status in GONE or (err and any(m in err for m in DNS)):
            errors += 1
            print(f"error: {status or err} {url} ({where})")
        else:
            warnings += 1
            print(f"warning: {status or err} {url} ({where})")
    print(f"{len(urls)} links checked: {errors} errors, {warnings} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
