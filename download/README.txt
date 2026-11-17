HelioFleet figure: code and data
================================

Moment:   {{TIME}}
Frame:    {{FRAME}}
View:     {{VIEW}}
Bodies:   {{BODIES}} shown on the map
Trails:   {{TRAIL}}
Spirals:  Parker spirals for {{WIND}} km/s solar wind (in spirals.csv)
Saved:    {{CREATED}} from HelioFleet {{VERSION}}
Page:     {{PAGE}}
          (opens the same view again)

What this is
------------
The spacecraft and planet positions behind the map you saw, with a short
Python script that draws them again. The figure it makes leaves out the
page's annotations (the coordinate table, instrument fields of view, CME
fronts and the near-Earth inset), so you can restyle it for a paper or a
talk: change colours, fonts, markers or the plotted range in the script.

{{BASE}}_preview.png is the snapshot from the page, to compare with.

Getting started
---------------
Python 3.9 or newer with NumPy and Matplotlib:

    pip install -r requirements.txt
    python plot_heliofleet.py

This writes heliofleet_<time>.png and .pdf in the current folder. Useful
options (python plot_heliofleet.py --help lists them all):

    --light              white background and dark ink, for print
    --range 1.5          half-width of the plot in au
    --view side          edge-on view, ecliptic north up
    --hide mars venus    leave bodies out, by the keys in positions.csv
    --no-trails --no-orbits --no-labels --no-grid
    --spirals / --no-spirals
    --size 4 --dpi 600   figure size in inches and PNG resolution
    --out figure1        output name

Files
-----
positions.csv   one row per body at the moment: key, name, kind (sc or
                planet), status, near_earth flag, x, y, z in the frame (au),
                distance from the Sun (au), Stonyhurst longitude and
                latitude (deg) and the colour used on the page.
trails.csv      the path of each spacecraft over the trail window, sampled
                as on the page; segment is past or future, and both
                segments include the moment itself.
orbits.csv      one orbital period of Earth and the planets.
spirals.csv     nominal Parker spirals from the Sun to each body, in the
                ecliptic plane, at the solar-wind speed above. They are
                drawn only if spirals were on (or with --spirals).
settings.json   the moment, frame, view, plotted range and centre, what
                was switched on, the page's colours and the link to the view.

Each CSV starts with comment lines (#) that describe the columns. They load
directly in Python, for example:

    import pandas as pd
    pos = pd.read_csv("positions.csv", comment="#")

Conventions
-----------
- Positions are geometric (no light-time or aberration correction), from
  JPL Horizons, interpolated as on the page.
- HEE: x points from the Sun to Earth at each moment, z to ecliptic north.
  In this frame a trail is the true co-rotating track: each sample is rotated
  by Earth's longitude at its own time. Inertial: J2000 ecliptic, x toward
  the equinox.
- The top view puts Earth at the bottom in HEE (plot x = frame y, plot
  y = -frame x), as on the page. The side view plots x against z.
- Spacecraft around Earth and the Sun-Earth L1 point (near_earth = 1) sit
  within 0.01 au of Earth, so they are listed next to Earth, not drawn.

Methods and accuracy: https://sr-dash.github.io/heliofleet/methods.html

Please cite HelioFleet: doi:{{DOI}}
and the ephemerides from JPL Horizons. The script is released under the MIT
licence.
