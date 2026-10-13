## What this changes

<!-- A short description of the change and why it is needed. Link the issue it addresses, e.g. "Closes #12". -->

## How it was checked

<!-- What you looked at: which pages, dates, themes or screen sizes; any comparison with Horizons, SunPy or an instrument paper. Screenshots help for visual changes. -->

## Checklist

- [ ] `python3 scripts/stamp_assets.py` run after changes in `css/` or `js/`, and the updated pages committed
- [ ] `python3 scripts/check_i18n.py` passes; new interface text added to `i18n/hi.json` and `i18n/es.json`
- [ ] `python3 scripts/check_data.py --no-stale` and `node tests/validate.mjs` pass
- [ ] New positions, coordinates or fields of view are sourced (Horizons ID or instrument paper) and documented in the README and on the methods page
- [ ] The change works on a phone-sized screen and in the light and dark themes
- [ ] I have read the [contributing guidelines](https://github.com/sr-dash/heliofleet/blob/main/CONTRIBUTING.md) and the [code of conduct](https://github.com/sr-dash/heliofleet/blob/main/CODE_OF_CONDUCT.md)
