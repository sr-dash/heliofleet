// Research workbench under the map: coordinate export, alignment search,
// spot visibility and time-series download, plus the code and citation sheet.

import { dateFromJD } from './ephem.js';
import { BODIES, SPACECRAFT } from './catalog.js';
import {
  sceneRows, toCSV, toJSON, timeSeries, sunpyCode, ALIGN_KINDS, findAlignments,
  windowsCSV, visibility, citationText, ALL_KEYS,
} from './tools.js';

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
  if (days < 1 / 24) return '< 1 h';
  if (days < 2) return `${Math.round(days * 24)} h`;
  return `${days.toFixed(1)} d`;
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
    if (tab.id === 'tab-align') primeAlign();
    if (tab.id === 'tab-series') primeSeries();
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
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.text); toast('Copied'); } catch { toast('Select the text to copy it'); }
      });
      row.appendChild(copy);
      if (b.file) {
        const dl = document.createElement('button');
        dl.className = 'btn-ghost';
        dl.textContent = `Download ${b.file.name}`;
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
    openSheet('SunPy code',
      'Reproduces this table independently with SunPy and JPL Horizons. HelioFleet agrees with SunPy to better than 0.01°; small differences come from interpolating daily samples.',
      [{ text: sunpyCode(S.jd, keys), file: { name: `heliofleet_${stamp(S.jd)}UT.py`, type: 'text/x-python' } }]);
  });

  // ---------- alignment search ----------
  const kindSel = $('align-kind');
  for (const [k, v] of Object.entries(ALIGN_KINDS)) kindSel.add(new Option(v.label, k));
  for (const k of SPACECRAFT) $('align-a').add(new Option(BODIES[k].name, k));
  $('align-b').add(new Option('Earth', 'earth'));
  for (const k of SPACECRAFT) $('align-b').add(new Option(BODIES[k].name, k));
  const defaults = { radial: ['solo', 'psp'], quadrature: ['sta', 'earth'], connection: ['psp', 'earth'] };
  const syncKind = (reset) => {
    const k = ALIGN_KINDS[kindSel.value];
    $('align-b-field').hidden = !k.needsB;
    $('align-help').textContent = k.help + (kindSel.value === 'connection' ? ` Uses the solar-wind speed set under Display (now ${S.wind} km/s).` : '');
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
    if (!(q.jd1 > q.jd0)) { out.innerHTML = '<p class="tool-summary">Set a start date before the end date.</p>'; return; }
    if (ALIGN_KINDS[q.kind].needsB && q.a === q.b) { out.innerHTML = '<p class="tool-summary">Choose two different bodies.</p>'; return; }
    const form = $('align-form');
    form.classList.add('busy');
    out.innerHTML = '<p class="tool-summary">Searching…</p>';
    try {
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
    const who = `${BODIES[q.a].name}${ALIGN_KINDS[q.kind].needsB ? ` and ${BODIES[q.b]?.name ?? 'Earth'}` : ''}`;
    if (!res.samples) {
      out.innerHTML = `<p class="tool-summary">No ephemeris overlaps for ${who} between ${day(q.jd0)} and ${day(q.jd1)}.</p>`;
      return;
    }
    if (!res.windows.length) {
      out.innerHTML = `<p class="tool-summary">No ${ALIGN_KINDS[q.kind].label.toLowerCase()} for ${who} within ${q.tol}° between ${day(q.jd0)} and ${day(q.jd1)}. Try a wider tolerance or range.</p>`;
      return;
    }
    const shown = res.windows.slice(0, 500);
    const unit = q.kind === 'quadrature' ? 'off 90°' : 'apart';
    out.innerHTML = `
      <p class="tool-summary"><span><b>${res.windows.length}</b> window${res.windows.length > 1 ? 's' : ''} for ${who}, within ${q.tol}°</span>
        <button class="btn-ghost" id="align-csv">Download CSV</button></p>
      <div class="table-wrap scroll"><table>
        <thead><tr><th>Start (UTC)</th><th>End (UTC)</th><th>Length</th><th>Closest (UTC)</th><th>Closest</th><th></th></tr></thead>
        <tbody>${shown.map((w, i) => `<tr><td>${minute(w.start)}</td><td>${minute(w.end)}</td><td>${duration(w.end - w.start)}</td><td>${minute(w.best)}</td><td>${w.value.toFixed(2)}° ${unit}</td><td><button data-i="${i}">Show</button></td></tr>`).join('')}</tbody>
      </table></div>
      ${res.windows.length > shown.length ? `<p class="tool-help">Showing the first ${shown.length}; the CSV has all of them.</p>` : ''}`;
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
  const spotLabel = (sp) => `${sp.sys === 'carrington' ? 'Carrington' : 'Stonyhurst'} ${sp.lon}°, ${sp.lat >= 0 ? '+' : '−'}${Math.abs(sp.lat)}°`;
  $('vis-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const lon = parseFloat($('vis-lon').value);
    const lat = parseFloat($('vis-lat').value);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) {
      $('vis-result').innerHTML = '<p class="tool-summary">Enter a longitude and a latitude between −90° and 90°.</p>';
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
      <p class="tool-summary"><span>${spotLabel(S.spot)} at ${minute(S.jd)} UTC: on the visible hemisphere for <b>${seen}</b> of ${rows.length} observers</span></p>
      <div class="table-wrap"><table>
        <thead><tr><th>Observer</th><th title="Angle between the local vertical and the line of sight">From disk centre</th><th title="Cosine of that angle">μ</th><th>Where</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td><span class="dot${BODIES[r.key].kind === 'planet' ? ' planet' : ''}" style="--c:var(--c-${r.key})"></span>${r.key === 'earth' ? 'Earth (ground-based)' : BODIES[r.key].short}</td><td>${r.theta.toFixed(1)}°</td><td>${r.theta < 90 ? r.mu.toFixed(3) : '—'}</td><td><span class="state ${cls[r.state]}">${r.state}</span></td></tr>`).join('')}</tbody>
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
    if (!keys.length) { toast('Choose at least one body'); return; }
    if (!(jd1 >= jd0)) { toast('Set a start date on or before the end date'); return; }
    const form = $('series-form');
    form.classList.add('busy');
    try {
      const rows = await timeSeries(keys, jd0, jd1, step, S.wind);
      const fmt = $('series-format').value;
      const name = `heliofleet_series_${day(jd0)}_${day(jd1)}.${fmt}`;
      save(fmt === 'csv' ? toCSV(rows, S) : toJSON(rows, S), name, fmt === 'csv' ? 'text/csv' : 'application/json');
      toast(`Saved ${rows.length.toLocaleString()} rows`);
    } catch (err) {
      toast(err.message);
    } finally {
      form.classList.remove('busy');
    }
  });

  // ---------- citation ----------
  $('cite').addEventListener('click', () => {
    const { apa, bib } = citationText();
    openSheet('Cite HelioFleet',
      'If HelioFleet helped your research, please cite it. The DOI <a href="https://doi.org/10.5281/zenodo.23328187">10.5281/zenodo.23328187</a> always points to the latest version; to cite version 1.0.0 specifically, use <a href="https://doi.org/10.5281/zenodo.23328188">10.5281/zenodo.23328188</a>. The same metadata is in <a href="https://github.com/sr-dash/heliofleet/blob/main/CITATION.cff">CITATION.cff</a>.',
      [
        { heading: 'Reference', text: apa, wrap: true },
        { heading: 'BibTeX', text: bib, file: { name: 'heliofleet.bib', type: 'application/x-bibtex' } },
      ]);
  });

  return {
    refresh() { renderVis(); },
    isOpen: () => sheet.open,
  };
}
