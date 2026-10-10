# HelioFleet

Where the Sun-watching spacecraft are, on any date since 2010.

**Live:** https://sr-dash.github.io/heliofleet

HelioFleet places SDO, Aditya-L1, Solar Orbiter, Parker Solar Probe, STEREO-A and STEREO-B around the Sun and Earth for any moment you choose. Pick a date and time in UTC, drag the timeline, or jump to a preset: every total and hybrid solar eclipse since 2010, mission milestones, and major space-weather events.

## Features

- **Two frames:** Earth-fixed (Heliocentric Earth Ecliptic, Earth at the bottom) or inertial ecliptic J2000.
- **Two views:** from ecliptic north, or edge-on to show orbital inclination (Solar Orbiter's climb out of the ecliptic).
- **Trails:** the past path fades and the future path is dotted. In the Earth-fixed frame the trail is the true co-rotating track.
- **Near-Earth inset:** Earth, the Moon, the Sun–Earth L1 point and Aditya-L1's halo orbit, with the Sun straight up.
- **Coordinates:** Stonyhurst heliographic longitude and latitude, Carrington longitude, separation from Earth, and the nominal Parker-spiral footpoint for a solar-wind speed you choose.
- **Parker spirals:** optional field lines through Earth and each spacecraft.
- **Snapshots:** download the current view as PNG or PDF, with the map, inset and coordinate table on one page.
- **Shareable links:** the URL keeps the moment and display settings, for example [the 2024 North American eclipse](https://sr-dash.github.io/heliofleet/?t=2024-04-08T18:17Z).
- **Four themes:** Night, Totality, H-alpha and Plate (light).

Keyboard: `←` / `→` step a day (`Shift` for an hour), `Space` plays and pauses, and the timeline takes arrow keys when focused.

## Data

Positions come from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), as heliocentric vectors in the ICRF ecliptic frame on a uniform UT grid. Most bodies are sampled daily and Parker every 3 hours. Geocentric Moon and Aditya-L1 vectors for the inset are sampled every 6 h and 2 h. The browser interpolates them with a 4-point Lagrange polynomial. Heliographic coordinates use the IAU solar rotation model and agree with SunPy to better than 0.01°.

<!-- coverage:start -->
| Spacecraft | Horizons ID | Coverage in this site |
|---|---|---|
| SDO | -136395 | 2010-02-12 to 2026-11-15; shown at Earth after its ephemeris ends (geosynchronous orbit) |
| Aditya-L1 | -156 | 2023-09-03 to 2027-01-21 |
| Solar Orbiter | -144 | 2020-02-11 to 2030-11-20 |
| Parker Solar Probe | -96 | 2018-08-12 to 2029-12-31 |
| STEREO-A | -234 | 2010-01-01 to 2027-01-14 |
| STEREO-B | -235 | 2010-01-01 to 2018-10-18; contact lost 2014-10-01; later positions are predictions |

Timeline: 2010-01-01 to 2030-11-19. Data last updated 2026-10-10; next scheduled update 2026-11-01.
<!-- coverage:end -->

Positions past each mission's latest tracking data are planning trajectories.

### Monthly updates

The [Update ephemeris](.github/workflows/update-ephemeris.yml) workflow runs at 06:17 UTC on the first day of each month. It asks Horizons how far each spacecraft's ephemeris now reaches and refetches every year from the previous one onward. That replaces predictions with fitted trajectories and appends new years when a mission publishes a longer prediction. The timeline grows with the latest spacecraft, and the page shows when the data was last updated and when the next update is due. It can also be run by hand from the Actions tab.

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
data/<body>/<year>.json  ephemeris chunks; data/manifest.json indexes them
assets/                  icons and the social preview image
site.webmanifest, sitemap.xml, favicon.ico
scripts/fetch_ephemeris.py
```

## License

MIT. See [LICENSE](LICENSE).
