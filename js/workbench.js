// Research workbench under the map: coordinate export, alignment search,
// spot visibility and time-series download, plus the code and citation sheet.

import { dateFromJD } from './ephem.js';
import { tr } from './i18n.js';
import { BODIES, SPACECRAFT } from './catalog.js';
import {
  sceneRows, toCSV, toJSON, timeSeries, sunpyCode, ALIGN_KINDS, findAlignments,
  geometryRows, geometrySunpy, GEOMETRY_COLUMNS,
  windowsCSV, visibility, citationText, CITATION, ALL_KEYS,
} from './tools.js';
import { recordAnimation, videoSupport, LIMITS } from './animate.js';

const $ = (id) => document.getElementById(id);
const day = (jd) => dateFromJD(jd + 1e-6).toISOString().slice(0, 10);
const minute = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16).replace('T', ' ');
const jdOfDay = (v) => Date.parse(`${v}T00:00Z`) / 864e5 + 2440587.5;
const stamp = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_');

function save(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function duration(days) {
  if (days < 1 / 24) return tr('< 1 h');
  if (days < 2) return tr('{n} h', { n: Math.round(days * 24) });
  return tr('{n} d', { n: days.toFixed(1) });
}

export function initWorkbench(ctx) {
  const { S, toast } = ctx;

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('.wb-tabs [role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    S.tab = tab.id.slice(4);
    ctx.writeURL();
    if (tab.id === 'tab-align') primeAlign();
    if (tab.id === 'tab-series') primeSeries();
    if (tab.id === 'tab-anim') primeAnim();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      n.focus();
      select(n);
    });
  });

  // ---------- sheet (code and citation) ----------
  const sheet = $('sheet');
  $('sheet-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  function openSheet(title, note, blocks) {
    $('sheet-title').textContent = title;
    $('sheet-note').innerHTML = note;
    const body = $('sheet-body');
    body.replaceChildren();
    for (const b of blocks) {
      if (b.heading) {
        const h = document.createElement('h3');
        h.textContent = b.heading;
        body.appendChild(h);
      }
      const pre = document.createElement('pre');
      pre.className = `code${b.wrap ? ' wrap' : ''}`;
      pre.textContent = b.text;
      body.appendChild(pre);
      const row = document.createElement('div');
      row.className = 'sheet-actions';
      const copy = document.createElement('button');
      copy.className = 'btn-primary';
      copy.textContent = tr('Copy');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.text); toast(tr('Copied')); } catch { toast(tr('Select the text to copy it')); }
      });
      row.appendChild(copy);
      if (b.file) {
        const dl = document.createElement('button');
        dl.className = 'btn-ghost';
        dl.textContent = tr('Download {name}', { name: b.file.name });
        dl.addEventListener('click', () => save(b.text, b.file.name, b.file.type));
        row.appendChild(dl);
      }
      body.appendChild(row);
    }
    sheet.showModal();
  }

  // ---------- coordinates: export the current table ----------
  const momentRows = () => sceneRows(ctx.scene(), S.wind, S.hidden);
  $('coords-csv').addEventListener('click', () => {
    if (!ctx.scene()) return;
    save(toCSV(momentRows(), S), `heliofleet_${stamp(S.jd)}UT.csv`, 'text/csv');
  });
  $('coords-json').addEventListener('click', () => {
    if (!ctx.scene()) return;
    save(toJSON(momentRows(), S), `heliofleet_${stamp(S.jd)}UT.json`, 'application/json');
  });
  $('coords-sunpy').addEventListener('click', () => {
    const sc = ctx.scene();
    if (!sc) return;
    const keys = sc.bodies.map((b) => b.key).filter((k) => !S.hidden.has(k));
    openSheet(tr('SunPy code'),
      tr('Reproduces this table independently with SunPy and JPL Horizons. HelioFleet agrees with SunPy to better than 0.01°; small differences come from interpolating daily samples.'),
      [{ text: sunpyCode(S.jd, keys), file: { name: `heliofleet_${stamp(S.jd)}UT.py`, type: 'text/x-python' } }]);
  });

  // ---------- viewing geometry ----------
  const geomRows = () => geometryRows(ctx.scene(), S.hidden);
  const sgn = (v, d) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  // Light-time offsets in seconds up to two minutes, then minutes
  const lag = (s) => (Math.abs(s) < 0.05 ? '0 s' : Math.abs(s) < 120 ? `${sgn(s, 1)} s` : `${sgn(s / 60, 2)} min`);
  function renderGeometry() {
    const body = $('geom-table').querySelector('tbody');
    const sc = ctx.scene();
    if (!sc) { body.replaceChildren(); return; }
    body.innerHTML = geomRows().map((g) => {
      const flag = g.status === 'lost' ? `<span class="flag">${tr('contact lost · predicted')}</span>` : g.status === 'approx' ? `<span class="flag">${tr('GEO · shown at Earth')}</span>` : '';
      const isEarth = g.body === 'earth';
      return `<tr><td><span class="dot" style="--c:var(--c-${g.body})"></span>${BODIES[g.body].short}${flag}</td>
        <td>${g.r_au.toFixed(g.r_au < 0.2 ? 4 : 3)}</td>
        <td>${isEarth ? tr('{s} from the Sun', { s: `${(g.light_time_s / 60).toFixed(2)} min` }) : lag(g.offset_vs_earth_s)}</td>
        <td>${g.rsun_arcsec.toFixed(1)}″</td>
        <td>${sgn(g.b0_deg, 2)}°</td>
        <td>${sgn(g.hgs_lon_deg, 2)}°</td>
        <td>${g.l0_deg.toFixed(2)}°</td>
        <td>${g.km_per_arcsec.toFixed(1)}</td>
        <td>${g.scale_vs_earth.toFixed(3)}</td></tr>`;
    }).join('');
  }
  $('geom-csv').addEventListener('click', () => {
    if (!ctx.scene()) return;
    save(toCSV(geomRows(), S, GEOMETRY_COLUMNS), `heliofleet_geometry_${stamp(S.jd)}UT.csv`, 'text/csv');
  });
  $('geom-json').addEventListener('click', () => {
    if (!ctx.scene()) return;
    save(toJSON(geomRows(), S, GEOMETRY_COLUMNS), `heliofleet_geometry_${stamp(S.jd)}UT.json`, 'application/json');
  });
  $('geom-sunpy').addEventListener('click', () => {
    const sc = ctx.scene();
    if (!sc) return;
    openSheet(tr('SunPy code'),
      tr('Reproduces the viewing-geometry table independently with SunPy and JPL Horizons.'),
      [{ text: geometrySunpy(S.jd, geomRows().map((g) => g.body)), file: { name: `heliofleet_geometry_${stamp(S.jd)}UT.py`, type: 'text/x-python' } }]);
  });

  // ---------- alignment search ----------
  const kindSel = $('align-kind');
  for (const [k, v] of Object.entries(ALIGN_KINDS)) kindSel.add(new Option(v.label, k));
  for (const k of SPACECRAFT) $('align-a').add(new Option(BODIES[k].name, k));
  $('align-b').add(new Option(BODIES.earth.name, 'earth'));
  for (const k of SPACECRAFT) $('align-b').add(new Option(BODIES[k].name, k));
  const defaults = { radial: ['solo', 'psp'], quadrature: ['sta', 'earth'], connection: ['psp', 'earth'] };
  const syncKind = (reset) => {
    const k = ALIGN_KINDS[kindSel.value];
    $('align-b-field').hidden = !k.needsB;
    $('align-help').textContent = k.help + (kindSel.value === 'connection' ? ` ${tr('Uses the solar-wind speed set under Display (now {v} km/s).', { v: S.wind })}` : '');
    if (reset) {
      $('align-tol').value = k.tol;
      [$('align-a').value, $('align-b').value] = defaults[kindSel.value];
    }
  };
  kindSel.addEventListener('change', () => syncKind(true));
  syncKind(true);
  let alignPrimed = false;
  function primeAlign() {
    if (alignPrimed) return;
    alignPrimed = true;
    const [lo, hi] = ctx.range();
    $('align-from').value = day(Math.max(lo, S.jd - 365));
    $('align-to').value = day(Math.min(hi, S.jd + 365));
  }

  let lastAlign = null;
  $('align-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const [lo, hi] = ctx.range();
    const q = {
      kind: kindSel.value,
      a: $('align-a').value,
      b: $('align-b').value,
      tol: parseFloat($('align-tol').value),
      jd0: Math.max(lo, jdOfDay($('align-from').value)),
      jd1: Math.min(hi, jdOfDay($('align-to').value) + 1),
      wind: S.wind,
    };
    const out = $('align-result');
    if (!(q.jd1 > q.jd0)) { out.innerHTML = `<p class="tool-summary">${tr('Set a start date before the end date.')}</p>`; return; }
    if (ALIGN_KINDS[q.kind].needsB && q.a === q.b) { out.innerHTML = `<p class="tool-summary">${tr('Choose two different bodies.')}</p>`; return; }
    const form = $('align-form');
    form.classList.add('busy');
    out.innerHTML = `<p class="tool-summary">${tr('Searching…')}</p>`;
    try {
      S.align = { kind: q.kind, a: q.a, b: q.b, tol: q.tol, from: $('align-from').value, to: $('align-to').value };
      ctx.writeURL();
      const res = await findAlignments(q);
      lastAlign = { res, q };
      renderAlign(res, q);
    } catch (err) {
      out.innerHTML = `<p class="tool-summary">${err.message}</p>`;
    } finally {
      form.classList.remove('busy');
    }
  });

  function renderAlign(res, q) {
    const out = $('align-result');
    const who = ALIGN_KINDS[q.kind].needsB ? tr('{a} and {b}', { a: BODIES[q.a].name, b: BODIES[q.b].name }) : BODIES[q.a].name;
    if (!res.samples) {
      out.innerHTML = `<p class="tool-summary">${tr('No ephemeris overlaps for {who} between {from} and {to}.', { who, from: day(q.jd0), to: day(q.jd1) })}</p>`;
      return;
    }
    if (!res.windows.length) {
      out.innerHTML = `<p class="tool-summary">${tr('No windows found for {who} within {tol}° between {from} and {to}. Try a wider tolerance or range.', { who, tol: q.tol, from: day(q.jd0), to: day(q.jd1) })}</p>`;
      return;
    }
    const shown = res.windows.slice(0, 500);
    const unit = q.kind === 'quadrature' ? tr('off 90°') : tr('apart');
    out.innerHTML = `
      <p class="tool-summary"><span>${tr(res.windows.length > 1 ? '<b>{n}</b> windows for {who}, within {tol}°' : '<b>{n}</b> window for {who}, within {tol}°', { n: res.windows.length, who, tol: q.tol })}</span>
        <button class="btn-ghost" id="align-csv">${tr('Download CSV')}</button></p>
      <div class="table-wrap scroll"><table>
        <thead><tr><th>${tr('Start (UTC)')}</th><th>${tr('End (UTC)')}</th><th>${tr('Length')}</th><th>${tr('Closest (UTC)')}</th><th>${tr('Closest')}</th><th></th></tr></thead>
        <tbody>${shown.map((w, i) => `<tr><td>${minute(w.start)}</td><td>${minute(w.end)}</td><td>${duration(w.end - w.start)}</td><td>${minute(w.best)}</td><td>${w.value.toFixed(2)}° ${unit}</td><td><button data-i="${i}">${tr('Show')}</button></td></tr>`).join('')}</tbody>
      </table></div>
      ${res.windows.length > shown.length ? `<p class="tool-help">${tr('Showing the first {n}; the CSV has all of them.', { n: shown.length })}</p>` : ''}`;
    out.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
      ctx.jump(shown[+b.dataset.i].best);
      document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    $('align-csv').addEventListener('click', () => {
      save(windowsCSV(lastAlign.res, lastAlign.q), `heliofleet_${q.kind}_${q.a}${ALIGN_KINDS[q.kind].needsB ? `_${q.b}` : ''}.csv`, 'text/csv');
    });
  }

  // ---------- visibility of a point on the Sun ----------
  if (S.spot) {
    $('vis-sys').value = S.spot.sys;
    $('vis-lon').value = S.spot.lon;
    $('vis-lat').value = S.spot.lat;
    $('vis-map').checked = S.spotOnMap;
  }
  const spotLabel = (sp) => `${tr(sp.sys === 'carrington' ? 'Carrington' : 'Stonyhurst')} ${sp.lon}°, ${sp.lat >= 0 ? '+' : '−'}${Math.abs(sp.lat)}°`;
  $('vis-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const lon = parseFloat($('vis-lon').value);
    const lat = parseFloat($('vis-lat').value);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) {
      $('vis-result').innerHTML = `<p class="tool-summary">${tr('Enter a longitude and a latitude between −90° and 90°.')}</p>`;
      return;
    }
    S.spot = { sys: $('vis-sys').value, lon, lat };
    S.spotOnMap = $('vis-map').checked;
    ctx.redraw();
  });
  $('vis-map').addEventListener('change', (e) => {
    S.spotOnMap = e.target.checked;
    if (S.spot) ctx.redraw();
  });
  $('vis-clear').addEventListener('click', () => {
    S.spot = null;
    $('vis-result').replaceChildren();
    ctx.redraw();
  });

  function renderVis() {
    const sc = ctx.scene();
    const out = $('vis-result');
    if (!S.spot || !sc) return;
    const { rows } = visibility(sc, S.spot, S.hidden);
    rows.sort((a, b) => a.theta - b.theta);
    const seen = rows.filter((r) => r.theta < 90).length;
    const cls = { 'on disk': 'on', 'near limb': 'limb', 'just behind limb': 'off', 'far side': 'off' };
    out.innerHTML = `
      <p class="tool-summary"><span>${tr('{spot} at {time} UTC: on the visible hemisphere for <b>{n}</b> of {total} observers', { spot: spotLabel(S.spot), time: minute(S.jd), n: seen, total: rows.length })}</span></p>
      <div class="table-wrap"><table>
        <thead><tr><th>${tr('Observer')}</th><th title="${tr('Angle between the local vertical and the line of sight')}">${tr('From disk centre')}</th><th title="${tr('Cosine of that angle')}">μ</th><th>${tr('Where')}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td><span class="dot${BODIES[r.key].kind === 'planet' ? ' planet' : ''}" style="--c:var(--c-${r.key})"></span>${r.key === 'earth' ? tr('Earth (ground-based)') : BODIES[r.key].short}</td><td>${r.theta.toFixed(1)}°</td><td>${r.theta < 90 ? r.mu.toFixed(3) : '—'}</td><td><span class="state ${cls[r.state]}">${tr(r.state)}</span></td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  // ---------- time series ----------
  const box = $('series-bodies');
  for (const k of ALL_KEYS) {
    const lab = document.createElement('label');
    const on = BODIES[k].kind === 'sc' || k === 'earth';
    lab.innerHTML = `<input type="checkbox" value="${k}"${on ? ' checked' : ''}><span class="dot${BODIES[k].kind === 'planet' ? ' planet' : ''}" style="--c:var(--c-${k})"></span>${BODIES[k].short}`;
    box.appendChild(lab);
  }
  let seriesPrimed = false;
  function primeSeries() {
    if (seriesPrimed) return;
    seriesPrimed = true;
    const [lo, hi] = ctx.range();
    $('series-from').value = day(Math.max(lo, S.jd - 30));
    $('series-to').value = day(Math.min(hi, S.jd + 30));
  }
  $('series-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keys = [...box.querySelectorAll('input:checked')].map((i) => i.value);
    const [lo, hi] = ctx.range();
    const jd0 = Math.max(lo, jdOfDay($('series-from').value));
    const jd1 = Math.min(hi, jdOfDay($('series-to').value));
    const step = parseFloat($('series-step').value);
    if (!keys.length) { toast(tr('Choose at least one body')); return; }
    if (!(jd1 >= jd0)) { toast(tr('Set a start date on or before the end date')); return; }
    const form = $('series-form');
    form.classList.add('busy');
    try {
      const rows = await timeSeries(keys, jd0, jd1, step, S.wind);
      const fmt = $('series-format').value;
      const name = `heliofleet_series_${day(jd0)}_${day(jd1)}.${fmt}`;
      save(fmt === 'csv' ? toCSV(rows, S) : toJSON(rows, S), name, fmt === 'csv' ? 'text/csv' : 'application/json');
      toast(tr('Saved {n} rows', { n: rows.length.toLocaleString('en-US') }));
    } catch (err) {
      toast(err.message);
    } finally {
      form.classList.remove('busy');
    }
  });

  // ---------- animation ----------
  const fmt = videoSupport();
  if (fmt === 'webm') $('anim-video-opt').textContent = tr('WebM video');
  let animPrimed = false;
  function primeAnim() {
    if (animPrimed) return;
    animPrimed = true;
    const [lo, hi] = ctx.range();
    $('anim-from').value = day(Math.max(lo, S.jd - 30));
    $('anim-to').value = day(Math.min(hi, S.jd + 30));
    animEstimate();
  }
  function animPlan() {
    const [lo, hi] = ctx.range();
    const jd0 = Math.max(lo, jdOfDay($('anim-from').value));
    const jd1 = Math.min(hi, jdOfDay($('anim-to').value));
    const step = parseFloat($('anim-step').value);
    const fps = parseInt($('anim-fps').value, 10);
    const [width, height] = $('anim-size').value.split('x').map(Number);
    const format = $('anim-format').value;
    const frames = jd1 >= jd0 ? Math.floor((jd1 - jd0) / step + 1e-9) + 1 : 0;
    return { jd0, jd1, step, fps, width, height, format, frames };
  }
  function animEstimate() {
    const p = animPlan();
    const limit = p.format === 'gif' ? LIMITS.gif : LIMITS.video;
    const kind = p.format === 'gif' ? 'GIF' : fmt === 'mp4' ? 'MP4 (H.264)' : 'WebM';
    $('anim-help').textContent = p.frames
      ? [
        tr('{n} frames, {s} s of {kind}.', { n: p.frames, s: (p.frames / p.fps).toFixed(1), kind }),
        p.frames > limit ? tr('That is over the {limit}-frame limit for this format.', { limit }) : '',
        tr('Uses the current frame, view, zoom, trails, overlays and theme.'),
        fmt === 'webm' && p.format === 'video' ? tr('This browser records WebM in real time.') : '',
      ].filter(Boolean).join(' ')
      : tr('Set a start date on or before the end date.');
  }
  $('anim-form').addEventListener('input', animEstimate);
  let abort = null;
  $('anim-cancel').addEventListener('click', () => abort?.abort());
  $('anim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = animPlan();
    if (!p.frames) { animEstimate(); return; }
    abort = new AbortController();
    $('anim-go').disabled = true;
    $('anim-cancel').hidden = false;
    $('anim-progress').hidden = false;
    $('anim-bar').value = 0;
    $('anim-status').textContent = tr('Loading ephemerides…');
    try {
      const { blob, ext } = await recordAnimation({
        ...p,
        S: { ...S, hidden: new Set(S.hidden) },
        theme: ctx.theme(),
        meta: ctx.frameMeta,
        signal: abort.signal,
        onProgress: (i, n) => {
          $('anim-bar').value = i / n;
          $('anim-status').textContent = tr('Frame {i} of {n}', { i, n });
        },
      });
      save(blob, `heliofleet_${day(p.jd0)}_${day(p.jd1)}.${ext}`, blob.type);
      $('anim-status').textContent = tr('Saved {size} MB {fmt}', { size: (blob.size / 1e6).toFixed(1), fmt: ext.toUpperCase() });
    } catch (err) {
      $('anim-status').textContent = err.name === 'AbortError' ? tr('Cancelled') : err.message;
    } finally {
      $('anim-go').disabled = false;
      $('anim-cancel').hidden = true;
      abort = null;
    }
  });

  // ---------- citation ----------
  $('cite').addEventListener('click', () => {
    const { apa, bib } = citationText();
    openSheet(tr('Cite HelioFleet'),
      tr(CITATION.versionDoi ? 'If HelioFleet helped your research, please cite it. The DOI {latest} always points to the latest version; to cite version {version} specifically, use {v1}. The same metadata is in {cff}.' : 'If HelioFleet helped your research, please cite it. The DOI {latest} always points to the latest version. The same metadata is in {cff}.', {
        version: CITATION.version,
        latest: `<a href="https://doi.org/${CITATION.doi}">${CITATION.doi}</a>`,
        v1: `<a href="https://doi.org/${CITATION.versionDoi}">${CITATION.versionDoi}</a>`,
        cff: '<a href="https://github.com/sr-dash/heliofleet/blob/main/CITATION.cff">CITATION.cff</a>',
      }),
      [
        { heading: tr('Reference'), text: apa, wrap: true },
        { heading: 'BibTeX', text: bib, file: { name: 'heliofleet.bib', type: 'application/x-bibtex' } },
      ]);
  });

  // A shared link reopens its tab, and reruns its alignment search
  if (S.align && ALIGN_KINDS[S.align.kind]) {
    select($('tab-align'));
    kindSel.value = S.align.kind;
    syncKind(false);
    if ([...$('align-a').options].some((o) => o.value === S.align.a)) $('align-a').value = S.align.a;
    if ([...$('align-b').options].some((o) => o.value === S.align.b)) $('align-b').value = S.align.b;
    if (S.align.tol > 0) $('align-tol').value = S.align.tol;
    $('align-from').value = S.align.from;
    $('align-to').value = S.align.to;
    $('align-form').requestSubmit();
  } else if (S.tab !== 'coords') {
    const t = $(`tab-${S.tab}`);
    if (t) select(t);
  }

  return {
    refresh() { renderVis(); renderGeometry(); },
    isOpen: () => sheet.open,
    openSheet,
    // From a spacecraft's card: open the tools with that body chosen
    alignWith(key) {
      select($('tab-align'));
      if (key !== 'earth') $('align-a').value = key;
      if ($('align-b').value === $('align-a').value) $('align-b').value = 'earth';
      document.querySelector('.workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    seriesFor(key) {
      select($('tab-series'));
      box.querySelectorAll('input').forEach((i) => { i.checked = i.value === key; });
      document.querySelector('.workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    showSpotTool() {
      select($('tab-vis'));
      document.querySelector('.workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('vis-lon').focus();
    },
    clearSpot() {
      S.spot = null;
      $('vis-result').replaceChildren();
    },
    syncSpot() {
      if (!S.spot) return;
      $('vis-sys').value = S.spot.sys;
      $('vis-lon').value = S.spot.lon;
      $('vis-lat').value = S.spot.lat;
      $('vis-map').checked = S.spotOnMap;
    },
  };
}
