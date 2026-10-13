# Contributing to HelioFleet

Thank you for helping. HelioFleet is meant to be useful to the whole heliophysics community, so reports, ideas, translations and code are all welcome. Everyone taking part is asked to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report something that looks wrong.** A position, coordinate, field of view or label that disagrees with another source is the most valuable report there is. Use the [issue forms](https://github.com/sr-dash/heliofleet/issues/new/choose) and include the link to the view (every view has one).
- **Ask for a spacecraft or instrument.** The "Add a spacecraft or instrument" form asks for the JPL Horizons ID and, for an instrument, the published field of view and its source.
- **Improve a translation.** The interface is in English, Hindi and Spanish. Corrections from native speakers are very welcome, and so are new languages (see [Translations](README.md#translations)).
- **Share how you use it** in [Discussions](https://github.com/sr-dash/heliofleet/discussions).
- **Send a pull request** for a fix or feature. For anything larger than a small fix, please open an issue or discussion first, so we can agree on the approach before you spend time on it.

## Running the site locally

The site is static and has no build step. Serve the repository root over HTTP:

```bash
python3 -m http.server 8000
```

and open <http://localhost:8000>. The data scripts need only the Python standard library; the checks below also need Node.js 22 or later.

## Before you open a pull request

Run the same checks as the **Check** workflow:

```bash
python3 scripts/stamp_assets.py         # after any change in css/ or js/
python3 scripts/check_i18n.py           # every interface string translated
python3 scripts/check_data.py --no-stale
node tests/validate.mjs                 # geometry against Horizons and SunPy
```

`stamp_assets.py` rewrites the asset links in the pages; commit the pages it changes. If you change interface text, add the new strings to `i18n/hi.json` and `i18n/es.json`; an English placeholder is fine if you do not speak the language, and the pull request can ask for help with it.

## Code style

- Plain ES modules in `js/`, no framework and no build step. Match the style of the surrounding code: short functions, descriptive names and a comment where the reason is not obvious.
- New geometry should come with a check in `tests/validate.mjs` against an independent reference (Horizons or SunPy), and a line on the [methods page](methods.html) if it changes what the site reports.
- Field-of-view numbers must come from a published instrument paper; cite it in `js/instruments.js`, the README and the methods page.
- Keep pages usable on a phone and readable in all four themes.

## Adding a spacecraft

1. Add its Horizons series to `BODIES` and `README_ROWS` in `scripts/fetch_ephemeris.py` (geocentric `*_geo` series for spacecraft near L1).
2. Add it to `js/catalog.js` (`SPACECRAFT`, `BODIES`, and `L1_FLEET` if it sits near L1), with its launch date, mission page and data archive.
3. Give it a colour in each theme in `css/style.css`; in the light theme the colour must reach a 4.5:1 contrast with the background.
4. Fetch its data with `python3 scripts/fetch_ephemeris.py --only <key> --from-year <year>`, then run the checks above. `tests/validate.mjs` also checks that the timeline reserves space for the new lane.

## Commits and pull requests

- One topic per pull request, with a short description of what changed and why.
- Write commit messages in the imperative ("Add Juno", "Fix the HI-2 outline") and keep them brief.
- Pull requests are reviewed by the maintainer. Contributions are released under the [MIT license](LICENSE) of the project.

## Security

Please report security problems privately through the repository's Security tab (**Report a vulnerability**), as described in the [security policy](SECURITY.md), not in a public issue.
