# HelioFleet

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23328187.svg)](https://doi.org/10.5281/zenodo.23328187)

Where the Sun-watching spacecraft are, on any date since 2010.

**Live:** https://sr-dash.github.io/heliofleet

HelioFleet places SDO, SOHO, Aditya-L1, ACE, Wind, DSCOVR, Solar Orbiter, Parker Solar Probe, BepiColombo, STEREO-A, STEREO-B and MAVEN around the Sun and Earth for any moment you choose. Pick a date and time in UTC, drag the timeline, or jump to a preset: every total and hybrid solar eclipse since 2010, mission milestones, and major space-weather events.

## Features

- **Spacecraft cards:** hover any body on the map or in the near-Earth panel for its distance, longitude and angle from Earth; click it for a card with heliocentric speed, distance and light time to Earth, the Sun's apparent size, the Sun–spacecraft–Earth angle, the previous and next perihelion, launch date, and links to the mission page and data archive. The card's buttons open the alignment search or data export for that spacecraft, hide it, or highlight its view of the Sun.
- **Instrument fields of view:** toggle the white-light coronagraphs and heliospheric imagers (SOHO LASCO C2/C3; STEREO COR2, HI-1, HI-2; Solar Orbiter Metis and SoloHI; Parker WISPR-I and WISPR-O) to see which parts of the heliosphere each one images. They are drawn in the ecliptic plane from the published elongation ranges: coronagraphs centred on the Sun, STEREO HI toward the Earth side of the Sun (the 2015 and 2023 spacecraft rolls kept them there), SoloHI to solar east and WISPR along Parker's direction of travel. Share a view with `fov=c3,hi1a,...`.
- **Helioviewer:** "Solar images in Helioviewer" opens [Helioviewer.org](https://helioviewer.org) at the selected moment (AIA 193, or EIT 195 before SDO). Spacecraft cards link straight to their own layers: SDO AIA and HMI; SOHO EIT and LASCO C2/C3; STEREO EUVI and COR2; Solar Orbiter EUI; and, from Earth's card, GONG H-alpha and MLSO K-Cor. Helioviewer shows the image nearest to that time.
- **Solar coverage:** a strip under the map shows which longitudes along the solar equator each observer sees, in Stonyhurst or Carrington longitude: solid within 60° of disk centre, pale out to the limb. The bottom row counts observers with a solar-disk imager (Earth with SDO, SOHO and Aditya-L1; STEREO; Solar Orbiter) per longitude and marks in red what no one sees, with the share of the Sun covered and the largest gap. Spacecraft without a disk imager are outlined for their geometry and not counted, and STEREO-B is left out after contact was lost. Click the strip to mark a longitude on the map.
- **Event search:** one box above the presets searches eclipses, mission milestones, every DONKI flare, CME and storm, and the upcoming calendar. It matches flare classes (`X9`), locations (`S07W33`), active regions (`12673`), dates (`2024-05`), names (`Gannon`, `Parker perihelion`) and storm levels (`G5`); every word must match, case and accents are ignored, and the nearest events come first.
- **Two frames:** Earth-fixed (Heliocentric Earth Ecliptic, Earth at the bottom) or inertial ecliptic J2000.
- **Two views:** from ecliptic north, or edge-on to show orbital inclination (Solar Orbiter's climb out of the ecliptic).
- **Trails:** the past path fades and the future path is dotted. In the Earth-fixed frame the trail is the true co-rotating track.
- **Near-Earth inset:** Earth, the Moon, the Sun–Earth L1 point and the orbits of SOHO, Aditya-L1, ACE, Wind and DSCOVR around it, with the Sun straight up.
- **Coordinates:** Stonyhurst heliographic longitude and latitude, Carrington longitude, separation from Earth, and the nominal Parker-spiral footpoint for a solar-wind speed you choose.
- **Parker spirals:** optional field lines through Earth and each spacecraft.
- **Snapshots:** download the current view as PNG or PDF, with the map, inset and coordinate table on one page.
- **Shareable links:** the URL keeps the moment and display settings, for example [the 2024 North American eclipse](https://sr-dash.github.io/heliofleet/?t=2024-04-08T18:17Z).
- **Four themes:** Night, Totality, H-alpha and Plate (light).
- **Three languages:** English, हिन्दी (Hindi) and Español (Spanish), chosen from the header, remembered per visitor, picked up from the browser's language, or set in a link with `lang=hi` or `lang=es`.

### Research tools

Below the map, four tabs work on the same geometry as the map:

- **Coordinates:** the table for the current moment, downloadable as CSV or JSON, plus a SunPy script that reproduces it independently from JPL Horizons.
- **Find alignments:** searches a date range for radial alignments of two spacecraft, quadratures with Earth, or magnetic connections (Parker-spiral footpoints within a tolerance). Each window lists its start, end and closest moment, with a button to jump there and a CSV of all windows.
- **Who sees this spot:** enter a Carrington or Stonyhurst location, such as an active region or flare site. Every observer gets its angle from disk centre, μ, and whether the spot is on disk, near the limb or behind it. The spot can be marked on the map and shared with `spot=c,LON,LAT` (Carrington) or `spot=s,LON,LAT` (Stonyhurst) in the URL.
- **Export data:** a time series for chosen bodies, dates and cadence (1 hour to 1 week) as CSV or JSON. Column definitions are written at the top of each file.
- **Animation:** records a date range as MP4 (H.264, encoded in the browser), WebM where MP4 encoding is unavailable, or GIF, at 800 × 450 up to 1920 × 1080, using the current view, overlays and theme.

### Space-weather events

The timeline and the **Space weather** presets carry events from NASA's [DONKI](https://ccmc.gsfc.nasa.gov/DONKI/) catalogue: flares of class M5 and above, CMEs of 1000 km/s and above, and geomagnetic storms of G3 and above. Choosing a flare jumps to its peak and marks its source region in Carrington longitude, so the marker rotates with the Sun as you step through time. CMEs appear on the map as fronts launched along their DONKI cone-model direction and width, moving out at the measured speed from their 21.5 solar-radius time; this constant-speed picture ignores drag, so real arrivals are usually later. `cme=0` in the URL hides them.

### Calendar

[calendar.ics](https://sr-dash.github.io/heliofleet/calendar.ics) lists upcoming perihelia (Parker Solar Probe, Solar Orbiter), radial alignments within 3° (between spacecraft or on the Sun–Earth line), quadratures with Earth within 1°, solar conjunctions within 2° of the Sun's centre as seen from Earth, and total solar eclipses. The **Upcoming** tab offers one-click subscription in Google Calendar and Apple Calendar, a copyable feed address for Outlook and other calendars (“Subscribe from web”), and a one-time `.ics` download. Each event links back to that moment in HelioFleet. The same events fill the **Upcoming** presets tab.

### Embedding

Add `embed=1` to any HelioFleet link to get the map alone, with a small time bar and a link to the full site, for use in an `<iframe>`. `theme=plate` (or `night`, `eclipse`, `halpha`) fixes the colours. The **Embed on your site** button writes the code for the current moment:

```html
<iframe src="https://sr-dash.github.io/heliofleet/?t=2024-04-08T18:17Z&embed=1" title="HelioFleet: spacecraft positions around the Sun" width="100%" height="560" style="border:0;border-radius:12px" loading="lazy"></iframe>
```

Keyboard: `←` / `→` step a day (`Shift` for an hour), `Space` plays and pauses, and the timeline takes arrow keys when focused.

## Data

Positions come from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), as heliocentric vectors in the ICRF ecliptic frame on a uniform UT grid. Most bodies are sampled daily and Parker every 3 hours. Geocentric Moon and Aditya-L1 vectors for the inset are sampled every 6 h and 2 h. The browser interpolates them with a 4-point Lagrange polynomial. Heliographic coordinates use the IAU solar rotation model and agree with SunPy to better than 0.01°.

<!-- coverage:start -->
| Spacecraft | Horizons ID | Coverage in this site |
|---|---|---|
| SDO | -136395 | 2010-02-12 to 2026-11-15; shown at Earth after its ephemeris ends (geosynchronous orbit) |
| SOHO | -21 | 2010-01-01 to 2026-11-02; Sun-Earth L1 |
| Aditya-L1 | -156 | 2023-09-03 to 2027-01-21; Sun-Earth L1 |
| ACE | -92 | 2010-01-01 to 2026-12-20; Sun-Earth L1 |
| Wind | -8 | 2010-01-01 to 2026-12-14; Sun-Earth L1 |
| DSCOVR | -78 | 2015-02-12 to 2026-10-25; Sun-Earth L1 |
| Solar Orbiter | -144 | 2020-02-11 to 2030-11-20 |
| Parker Solar Probe | -96 | 2018-08-12 to 2029-12-31 |
| STEREO-A | -234 | 2010-01-01 to 2027-01-14 |
| STEREO-B | -235 | 2010-01-01 to 2018-10-18; contact lost 2014-10-01; later positions are predictions |
| BepiColombo | -121 | 2018-10-21 to 2027-04-10 |
| MAVEN | -202 | 2013-11-19 to 2026-03-01; Mars orbit |

Timeline: 2010-01-01 to 2030-11-19. Data last updated 2026-10-13; next scheduled update 2026-11-01.
<!-- coverage:end -->

Positions past each mission's latest tracking data are planning trajectories.

### Monthly updates

The [Update ephemeris](.github/workflows/update-ephemeris.yml) workflow runs at 06:17 UTC on the first day of each month. It also merges the last 150 days of DONKI events (`scripts/fetch_events.py`) and rebuilds the calendar (`scripts/build_calendar.py`). For the ephemerides, it asks Horizons how far each spacecraft's ephemeris now reaches and refetches every year from the previous one onward. That replaces predictions with fitted trajectories and appends new years when a mission publishes a longer prediction. The timeline grows with the latest spacecraft, and the page shows when the data was last updated and when the next update is due. It can also be run by hand from the Actions tab.

To run the same update locally:

```bash
python3 scripts/fetch_ephemeris.py --incremental
```

Without `--incremental` the script rebuilds everything from 2010. `--only psp,solo` limits it to selected bodies. The script needs only the Python standard library.

## Running locally

The site is static, but it must be served over HTTP so the browser can load the data files:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Layout

```
index.html               page shell
css/style.css            themes and layout
js/app.js                state, controls, URL sync
js/ephem.js              lazy per-year data loading and interpolation
js/frames.js             HEE/HEEQ/Carrington geometry, Parker spirals
js/scene.js              positions, trails and readouts for one moment
js/render.js             canvas drawing for the map and inset
js/ribbon.js             timeline with mission lanes and presets
js/export.js             PNG / PDF snapshot
js/catalog.js            spacecraft, eclipses, milestones, events
js/tools.js              exports, SunPy code, alignment search, spot visibility
js/workbench.js          the research-tools tabs and the code/citation sheet
js/events.js             DONKI events, CME fronts, upcoming events
js/animate.js            MP4 / WebM / GIF recording
js/cards.js              hover tooltips and spacecraft cards
js/bodyinfo.js           speed, light time, apparent Sun size, perihelia
js/coverage.js           solar coverage strip
js/instruments.js        coronagraph and imager fields of view
js/helioviewer.js        Helioviewer.org layers and links
sky.html, js/sky.js      sky view sub-page (Earth or a spacecraft)
js/skyproj.js            plane-of-sky projection, ground sites, Sun altitude
data/ground/cryonirsp.json  DKIST Cryo-NIRSP footprints
scripts/fetch_ground.py  builds it from the Cryo-NIRSP viewer inventory
scripts/stamp_assets.py  content-hashed asset URLs for index.html
js/i18n.js               language choice and translation
i18n/<lang>.json         Hindi and Spanish interface text
scripts/check_i18n.py    finds untranslated or mismatched strings
scripts/fetch_events.py  DONKI flares, CMEs and storms -> data/events.json
scripts/build_calendar.py  calendar.ics and data/upcoming.json
data/<body>/<year>.json  ephemeris chunks; data/manifest.json indexes them
assets/                  icons and the social preview image
site.webmanifest, sitemap.xml, favicon.ico
CITATION.cff, .zenodo.json  citation metadata
scripts/fetch_ephemeris.py
```

## Acknowledgements

- Solar images: [Helioviewer.org](https://helioviewer.org), linked at the selected moment.
- DKIST Cryo-NIRSP observations: the [DKIST Data Center](https://dkist.data.nso.edu/), via the [Cryo-NIRSP viewer](https://sr-dash.github.io/cryonirsp-viewer/). MLSO K-Cor and UCoMP are operated by the [High Altitude Observatory](https://www2.hao.ucar.edu/mlso).
- Spacecraft and planet positions: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), Solar System Dynamics Group, NASA Jet Propulsion Laboratory.
- Flares, CMEs and geomagnetic storms, including the CME speeds, directions and widths behind the CME fronts on the map: the Space Weather Database Of Notifications, Knowledge, Information ([DONKI](https://ccmc.gsfc.nasa.gov/DONKI/)), developed and maintained by the [Community Coordinated Modeling Center](https://ccmc.gsfc.nasa.gov/) at NASA Goddard Space Flight Center.
- Heliographic coordinates follow the IAU solar rotation model as implemented in [SunPy](https://sunpy.org/), which was used to validate them.

### Earth's view and spacecraft views (sky.html)

A second page, [Earth's view](https://sr-dash.github.io/heliofleet/sky.html), draws the plane of the sky seen from an observer, through Sun centre and perpendicular to the Sun–observer line, with solar north up and west to the right, as in a solar image. The observer is Earth by default; the **View from** list switches to Solar Orbiter, Parker Solar Probe, BepiColombo, STEREO-A, STEREO-B or MAVEN on dates when it has a position (`?obs=solo` in the link). Each instrument's field of view is projected onto that plane by following its lines of sight from its own spacecraft to where they cross it, so the observer's own coronagraphs appear as rings while fields from spacecraft far from the observer's line of sight stretch across the sky. On the same plane:

- **MLSO K-Cor** (1.05–3 R☉) and **UCoMP** (1.05–2 R☉) at Mauna Loa;
- **DKIST Cryo-NIRSP** observation footprints within 12 hours of the moment, from the [Cryo-NIRSP viewer](https://sr-dash.github.io/cryonirsp-viewer/) inventory (refreshed monthly by `scripts/fetch_ground.py`), each linked to its page in that viewer, with buttons to step to earlier or later observing days;
- the Sun's altitude and daylight window at Haleakalā (DKIST) and Mauna Loa (MLSO);
- Earth and the spacecraft, placed where the observer sees them in perspective, with an edge marker for those behind the observer.

The MLSO and DKIST fields are traced from Earth in the same way, so from another observer they show where Earth's lines of sight cross that observer's plane of the sky. The page saves PNG and PDF snapshots of the current view.

Heliospheric imagers are modelled as fields of their published size (HI-1 a 20° square, HI-2 a 70° circle, SoloHI a 40° circle, WISPR-I 40° and WISPR-O 58° squares tilted 10° south), so their outlines on this page are approximate.

### Instrument field-of-view sources

Brueckner et al. 1995, Solar Physics 162, 357 (LASCO); Howard et al. 2008, Space Science Reviews 136, 67 (SECCHI COR2); Eyles et al. 2009, Solar Physics 254, 387 (STEREO HI); Antonucci et al. 2020, A&A 642, A10 (Metis); Howard et al. 2020, A&A 642, A13 (SoloHI); Vourlidas et al. 2016, Space Science Reviews 204, 83 (WISPR).

## Maintenance

- After changing anything in `css/` or `js/`, run `python3 scripts/stamp_assets.py`. It gives every stylesheet and module a content-hashed URL, so visitors never run a mix of old and new files while browsers still hold cached copies.
- The **Check** workflow runs on every push: JavaScript syntax, `scripts/check_i18n.py`, the asset stamps, and that every data file parses.
- Feedback comes through the issue forms (feature request, something looks wrong, add a spacecraft or instrument, translation fix) and the Discussions tab, linked from the page footer.

## Translations

Interface text lives in `i18n/hi.json` and `i18n/es.json`, keyed by the English text, so anything without a translation falls back to English. Spacecraft names, dates, numbers and the exported data files (CSV, JSON, SunPy code, citation) stay in English. After changing any interface text, run:

```bash
python3 scripts/check_i18n.py
```

It lists every English string the page can show and reports, for each language, the strings that are missing and entries whose `{placeholders}` differ. `--keys` prints the full list, which is the place to start when adding another language. Corrections from native speakers are very welcome as pull requests or issues.

## Citing HelioFleet

If HelioFleet helps your research, please cite it:

> Dash, S. (2026). *HelioFleet: an interactive map of heliophysics spacecraft positions* (Version 1.1.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.23328187

That DOI always resolves to the latest release. Each release also has its own DOI, listed on the [Zenodo record](https://doi.org/10.5281/zenodo.23328187); [10.5281/zenodo.23330591](https://doi.org/10.5281/zenodo.23330591) is version 1.1.0 and [10.5281/zenodo.23328188](https://doi.org/10.5281/zenodo.23328188) is version 1.0.0. GitHub's **Cite this repository** button (from [CITATION.cff](CITATION.cff)) and the **Cite HelioFleet** button on the page give APA and BibTeX references.

## License

MIT. See [LICENSE](LICENSE).
