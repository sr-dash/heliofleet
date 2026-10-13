# Security policy

HelioFleet is a static website: HTML, CSS, JavaScript modules and JSON data served by GitHub Pages, with no server-side code, user accounts or stored personal data. Its GitHub Actions workflows fetch public data from JPL Horizons, NASA CCMC DONKI and the Cryo-NIRSP viewer, and commit the results to this repository.

## Supported versions

Only the current version of the site, built from the `main` branch and published at <https://sr-dash.github.io/heliofleet/>, receives fixes. Archived releases on Zenodo are kept unchanged as records.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Write instead to the maintainer, Soumyaranjan Dash, at <sdash@nso.edu>, with:

- what the problem is and where it is (a page, a script, a workflow or a data file);
- how to reproduce it;
- what an attacker could do with it, if you know.

You should receive a reply within a week. Once the problem is confirmed, a fix will be published as soon as practical, and you will be credited in the commit and release notes unless you prefer otherwise.

## What is in scope

- Code on the site that could run attacker-controlled script, for example through link parameters, imported data or the embed mode.
- The GitHub Actions workflows, their permissions and the scripts they run.
- Data files that could be altered to mislead users of the site.

Problems in the external services the site links to or reads from (JPL Horizons, DONKI, Helioviewer, the DKIST Data Center, Google Analytics, Google Fonts or the cdnjs CDN) should be reported to those services directly.
