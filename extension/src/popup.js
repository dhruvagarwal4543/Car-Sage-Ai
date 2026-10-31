import { DEFAULTS, MAX_COMPARE, altPrefs, carUrl, chartPoints, cleanEntries, compareUrl, inr, makeApi, safeUrl, splitTitle } from './core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));   // listing text is untrusted
const store = {
  get: async (k, d) => { try { return (await chrome.storage.local.get(k))[k] ?? d; } catch { return d; } },   // unreadable storage: start empty
  set: async (k, v) => { try { await chrome.storage.local.set({ [k]: v }); } catch { alert('CarSage could not save this on the device (storage is full or blocked).'); } },
};
const TYPES = { ex_showroom: 'Ex-showroom', on_road: 'On-road', used_asking: 'Used asking price', advertised: 'Advertised', unknown: 'Unknown price type' };

const S = { cfg: DEFAULTS, api: null, scan: null, vehicle: null, match: null, car: null, makes: null, compare: [], saved: [], panel: '' };

const fail = (e) => `<p class="bad" role="alert">${esc(e.message)} <button data-act="retry">Retry</button></p>`;
const carLine = (c) => `${esc(c.make)} ${esc(c.model)} ${esc(c.variant)} · ${esc(c.fuel_type)}${c.transmission ? ' · ' + esc(c.transmission) : ''} · ${inr(c.price_inr)}`;
const entry = (c, extra = {}) => ({ carId: c.id, label: `${c.make} ${c.model} ${c.variant}`, site: 'CarSage catalogue', sourceUrl: null, priceInr: c.price_inr, priceType: 'ex_showroom', observedAt: new Date().toISOString(), ...extra });
const fromListing = () => entry(S.car, { site: S.vehicle.site, sourceUrl: S.vehicle.url, listing: S.vehicle.title, priceInr: S.vehicle.priceInr ?? S.car.price_inr, priceType: S.vehicle.priceInr ? S.vehicle.priceType : 'ex_showroom' });

// ---- page detection ------------------------------------------------------------------------------------------------
async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) return { supported: false, vehicles: [], reason: 'Open a car page in a normal browser tab, then reopen CarSage.' };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/adapters.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => CarSageAdapters.detect(document, location.href) });
    return result;
  } catch { return { supported: false, vehicles: [], reason: 'CarSage cannot read this page (it is protected by the browser).' }; }
}

async function resolveMatch(v) {
  S.match = { status: 'loading' }; S.car = null; render();
  try {
    S.makes ??= (await S.api.filters()).makes.map((m) => m.value);
    let sp = splitTitle(v.title, S.makes);
    const make = sp.make || v.make;
    if (sp.make) sp = splitTitle(v.title, S.makes, (await S.api.filters(sp.make)).models.map((m) => m.value));
    const model = sp.model || v.model;
    if (!make || !model) { S.match = { status: 'unresolved' }; return render(); }
    const r = await S.api.match({ make, model, variant: sp.variant || undefined, fuel_type: v.fuelType || undefined });
    S.match = r; if (r.status === 'exact') S.car = r.candidates[0];
  } catch (e) { S.match = { status: 'error', error: e }; }
  render();
}

// ---- rendering -----------------------------------------------------------------------------------------------------
function renderVehicle() {
  const { scan: sc, vehicle: v, match: m, car } = S;
  if (!sc) return '<p class="muted">Reading this page…</p>';
  if (!v) return `<div class="card"><p class="title">${sc.supported ? 'No car found' : 'Page not supported'}</p><p class="muted">${esc(sc.reason)}</p><button data-act="rescan">Rescan</button></div>`;
  const pick = sc.vehicles.length > 1 ? `<label>Several cars on this page — choose one<select data-act="pickVehicle">${sc.vehicles.map((x, i) => `<option value="${i}" ${x === v ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>` : '';
  const img = safeUrl(v.image);
  const price = v.priceInr ? `${inr(v.priceInr)}${v.priceIsRange ? ' (starting price; the page shows more than one price)' : ''} · ${TYPES[v.priceType]}` : 'Price not found on page';
  const opts = (one, many) => one || (many.length > 1 ? many.join(' / ') + ' available' : null);
  const facts = [v.modelYear, v.status === 'used' ? 'Used' : 'New', opts(v.fuelType, v.fuelOptions), opts(v.transmission, v.transmissionOptions), v.displacementCc && `${v.displacementCc} cc`,
    v.odometerKm != null && `${v.odometerKm.toLocaleString()} km`, v.location, v.mileage.length && 'Mileage ' + v.mileage.map((m) => `${m.label ? m.label + ' ' : ''}${m.value} ${m.unit}`.trim()).join(', ')].filter(Boolean).join(' · ');
  const link = safeUrl(v.canonicalUrl) || safeUrl(v.url);
  let matchHtml = '';
  if (m?.status === 'loading') matchHtml = '<p class="muted">Matching to the catalogue…</p>';
  else if (m?.status === 'error') matchHtml = fail(m.error);
  else if (m?.status === 'unresolved') matchHtml = '<p class="warn">Could not tell the make and model. Search the catalogue below.</p>';
  else if (m?.status === 'unmatched') matchHtml = '<p class="warn">This model is not in the CarSage catalogue, so it cannot be compared or priced. You can still save it on this device.</p>';
  else if (car) matchHtml = `<p class="ok">Matched: ${carLine(car)}</p>${m?.status === 'ambiguous' ? '<button data-act="rechoose">Change variant</button><p class="muted">Add this one, then change the variant and add another to compare variants of the same model.</p>' : ''}`;
  else if (m?.status === 'ambiguous') matchHtml = `<p class="warn">${m.total_candidates} catalogue variants fit. Choose the right one:</p><label class="sr" for="cand">Catalogue variant</label><select id="cand"><option value="">Choose a variant…</option>${m.candidates.map((c) => `<option value="${c.id}">${carLine(c)}</option>`).join('')}</select><button class="primary" data-act="confirm">Confirm variant</button><p class="muted">${esc(m.note || '')}</p>`;
  const on = car ? '' : 'disabled title="Match the car to the catalogue first"';
  return `<div class="card">${pick}<div class="row">${img ? `<img class="thumb" src="${esc(img)}" alt="">` : ''}<div><div class="title">${esc(v.title)}</div><div class="muted">${esc(facts)}</div><div>${esc(price)}</div>
    <div class="muted">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(v.site)}</a>` : esc(v.site)} · detected via ${v.source === 'json-ld' ? 'page metadata' : 'page text'} · confidence ${esc(v.confidence)}</div></div></div>${matchHtml}
    <div class="actions"><button class="primary" data-act="save">Save (this device)</button><button data-act="addCompare" ${on}>Add to Compare</button><button data-act="history" ${on}>Price History</button>
    <button data-act="alts" ${on}>Find Alternatives</button><button data-act="open" ${on}>Open Details</button><button data-act="rescan">Rescan</button></div></div>`;
}

function renderPanel() {
  if (S.panel === 'alts') return '<h2>Alternatives</h2><div class="card"><label class="inline"><input type="checkbox" id="sf" checked>same fuel</label><label class="inline"><input type="checkbox" id="sb">same body</label><label class="inline"><input type="checkbox" id="st">same transmission</label>'
    + `<label>Budget up to (₹ lakh)<input id="bud" type="number" min="1" step="0.5" value="${Math.round(((S.vehicle.priceInr || S.car.price_inr) / 1e5) * 10) / 10}"></label><button class="primary" data-act="runAlts">Find</button><div id="altOut"></div></div>`;
  if (S.panel === 'history') {
    const v = S.vehicle, type = v.priceType === 'unknown' ? (v.status === 'used' ? 'used_asking' : 'ex_showroom') : v.priceType;
    return `<h2>Price history</h2><div class="card"><label>Model year<input id="hy" type="number" min="1900" max="2100" value="${v.modelYear || new Date().getFullYear()}"></label>
      <label>Market (country and city, as recorded)<input id="hm" value="India"></label><label>Price type<select id="ht">${Object.entries(TYPES).filter(([k]) => k !== 'unknown').map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="actions">${[1, 2, 3].map((y) => `<button data-act="runHistory" data-years="${y}">${y} year${y > 1 ? 's' : ''}</button>`).join('')}</div><div id="histOut"></div></div>`;
  }
  return '';
}

const listHtml = (title, items, rm, extra = '') => `<h2>${title} (${items.length})</h2>${items.length ? `<ul>${items.map((x, i) => `<li><div class="title">${esc(x.listing || x.label)}</div><div class="muted">${esc(x.site)} · listing price ${inr(x.priceInr)} ${esc(TYPES[x.priceType] || '')} · ${esc(x.observedAt.slice(0, 10))}${x.carId ? '' : ' · not in catalogue'}</div>
  ${x.listing && x.carId ? `<div class="muted">Compared as catalogue car: ${esc(x.label)}</div>` : ''}
  ${safeUrl(x.sourceUrl) ? `<a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original listing</a> ` : ''}<button data-act="${rm}" data-i="${i}" aria-label="Remove ${esc(x.label)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}${extra}`;

function render() {
  $('vehicle').innerHTML = renderVehicle();
  $('panel').innerHTML = renderPanel();
  const ids = S.compare.map((x) => x.carId), url = compareUrl(S.cfg.siteBase, ids);
  const need = S.compare.length < 2 ? `<p class="warn">Add ${2 - S.compare.length} more car${S.compare.length ? '' : 's'} to compare: search below, or open another car page and press Add to Compare (2 to ${MAX_COMPARE} cars).</p>` : '';
  $('compare').innerHTML = listHtml('Compare', S.compare, 'rmCompare', `${need}<button class="primary" data-act="openCompare" ${url ? '' : 'disabled'}>Open comparison</button>`);
  $('saved').innerHTML = listHtml('Saved on this device', S.saved, 'rmSaved', '<p class="muted">Account sync needs sign-in on the CarSage website; it is not available in the extension yet.</p>');
}

// ---- actions -------------------------------------------------------------------------------------------------------
const open = (url) => chrome.tabs.create({ url });
const addCompare = async (e) => {
  if (S.compare.some((x) => x.carId === e.carId)) return;
  if (S.compare.length >= MAX_COMPARE) return alert(`You can compare up to ${MAX_COMPARE} cars.`);
  S.compare.push(e); await store.set('compare', S.compare); render();
};

async function runHistory(years) {
  const out = $('histOut'); out.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await S.api.history({ car_id: S.car.id, model_year: Number($('hy').value), market: $('hm').value.trim(), price_type: $('ht').value, vehicle_status: S.vehicle.status, years });
    out.innerHTML = r.series.length ? r.series.map((s) => {
      const pts = chartPoints(s.observations, 340, 120);
      return `<p class="title">${esc(s.source_website)} <span class="muted">(${esc(s.source_kind.replace('_', ' '))})</span></p>
        <svg class="chart" viewBox="0 0 340 120" role="img" aria-label="Price history, ${s.observations.length} observation(s)"><polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" tabindex="0"><title>${esc(p.obs.observed_at.slice(0, 10))}: ${inr(p.obs.price_inr)}</title></circle>`).join('')}</svg>
        <p>${s.absolute_change_inr == null ? 'Only one observation: no change to show.' : `Change: ${s.absolute_change_inr < 0 ? '−' : '+'}${inr(Math.abs(s.absolute_change_inr))}${s.percentage_change == null ? '' : ` (${s.percentage_change}%)`}`}
        · covers ${esc((s.coverage_start || '').slice(0, 10))} to ${esc((s.coverage_end || '').slice(0, 10))}</p>
        <ul>${s.observations.map((o) => `<li>${esc(o.observed_at.slice(0, 10))} · ${inr(o.price_inr)}</li>`).join('')}</ul>`;
    }).join('') + `<p class="muted">${esc(r.notice)} Last updated ${esc((r.last_updated || '—').slice(0, 10))}.</p>` : `<p class="warn">No sourced price observations exist for this exact car, year, market and price type.</p><p class="muted">${esc(r.notice)}</p>`;
  } catch (e) { out.innerHTML = fail(e).replace('data-act="retry"', `data-act="runHistory" data-years="${years}"`); }
}

async function runAlts() {
  const out = $('altOut'); out.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const budget = Math.round(Number($('bud').value) * 1e5);
    const r = await S.api.recommend(altPrefs(S.car, { budgetInr: budget > 0 ? budget : 0, sameFuel: $('sf').checked, sameBody: $('sb').checked, sameTransmission: $('st').checked }));
    const rows = r.recommendations.filter((x) => x.car.model !== S.car.model).slice(0, 5);
    out.innerHTML = rows.length ? `<ul>${rows.map((x) => `<li><div class="title">${carLine(x.car)}</div><div class="muted">Score ${x.score}/100 · ${esc(x.reasons.slice(0, 2).join('; '))}</div>
      <button data-act="altOpen" data-id="${x.car.id}">Open</button> <button data-act="altCompare" data-id="${x.car.id}" data-label="${esc(`${x.car.make} ${x.car.model} ${x.car.variant}`)}" data-price="${x.car.price_inr}">Add to Compare</button></li>`).join('')}</ul><p class="muted">${esc(r.notes.join(' '))}</p>`
      : `<p class="warn">No other model matches these requirements.</p><p class="muted">${esc(r.notes.join(' '))}</p>`;
  } catch (e) { out.innerHTML = fail(e).replace('data-act="retry"', 'data-act="runAlts"'); }
}

let timer;
function search() {
  clearTimeout(timer);
  const q = $('q').value.trim(), out = $('results');
  if (!q) { out.innerHTML = ''; return; }
  out.innerHTML = '<p class="muted">Searching…</p>';
  timer = setTimeout(async () => {
    try {
      const r = await S.api.search(q);
      out.innerHTML = r.items.length ? `<ul>${r.items.map((c) => `<li><div class="title">${carLine(c)}</div><button data-act="rOpen" data-id="${c.id}">Open</button>
        <button data-act="rCompare" data-id="${c.id}" data-label="${esc(`${c.make} ${c.model} ${c.variant}`)}" data-price="${c.price_inr}">Add to Compare</button></li>`).join('')}</ul>` : '<p class="muted">No cars match that search.</p>';
    } catch (e) { out.innerHTML = fail(e).replace('data-act="retry"', 'data-act="search"'); }
  }, 300);
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
  const d = b.dataset, mini = () => ({ carId: Number(d.id), label: d.label, site: 'CarSage catalogue', sourceUrl: null, priceInr: Number(d.price), priceType: 'ex_showroom', observedAt: new Date().toISOString() });
  switch (d.act) {
    case 'rescan': return init(false);
    case 'retry': return S.match?.status === 'error' ? resolveMatch(S.vehicle) : checkConn();
    case 'rechoose': S.car = null; S.panel = ''; return render();
    case 'confirm': S.car = S.match.candidates.find((c) => c.id === Number($('cand').value)) || null; return render();   // no choice made: stay unmatched
    case 'save': {
      const e = S.car ? fromListing() : { carId: null, label: S.vehicle.title, site: S.vehicle.site, sourceUrl: S.vehicle.url, priceInr: S.vehicle.priceInr, priceType: S.vehicle.priceType, observedAt: new Date().toISOString() };
      if (!S.saved.some((x) => (x.sourceUrl || x.carId) === (e.sourceUrl || e.carId))) { S.saved.push(e); await store.set('saved', S.saved); }
      return render();
    }
    case 'addCompare': return addCompare(fromListing());
    case 'history': case 'alts': S.panel = S.panel === d.act ? '' : d.act; return render();
    case 'runHistory': return runHistory(Number(d.years));
    case 'runAlts': return runAlts();
    case 'open': return open(carUrl(S.cfg.siteBase, S.car.id));
    case 'rOpen': case 'altOpen': return open(carUrl(S.cfg.siteBase, d.id));
    case 'rCompare': case 'altCompare': return addCompare(mini());
    case 'search': return search();
    case 'rmCompare': S.compare.splice(Number(d.i), 1); await store.set('compare', S.compare); return render();
    case 'rmSaved': S.saved.splice(Number(d.i), 1); await store.set('saved', S.saved); return render();
    case 'openCompare': return open(compareUrl(S.cfg.siteBase, S.compare.map((x) => x.carId)));
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.act === 'pickVehicle') { S.vehicle = S.scan.vehicles[Number(ev.target.value)]; S.panel = ''; resolveMatch(S.vehicle); }
});
$('q').addEventListener('input', search);
$('theme').addEventListener('click', async () => {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark'; await store.set('theme', document.documentElement.dataset.theme);
});
$('saveCfg').addEventListener('click', async () => {
  const strip = (u) => u.trim().replace(/\/+$/, '');
  S.cfg = { apiBase: strip($('apiBase').value) || DEFAULTS.apiBase, siteBase: strip($('siteBase').value) || DEFAULTS.siteBase };
  await store.set('cfg', S.cfg); S.api = makeApi(S.cfg.apiBase); S.makes = null; checkConn(); render();
});

async function checkConn() {
  const el = $('conn'); el.className = 'pill'; el.textContent = 'Connecting…';
  try { await S.api.health(); el.className = 'pill ok'; el.textContent = 'Connected'; } catch (e) { el.className = 'pill bad'; el.textContent = 'Offline'; el.title = e.message; }
}

async function init(first = true) {
  if (first) {
    const cfg = await store.get('cfg', {}); S.cfg = { apiBase: safeUrl(cfg.apiBase) || DEFAULTS.apiBase, siteBase: safeUrl(cfg.siteBase) || DEFAULTS.siteBase }; S.api = makeApi(S.cfg.apiBase);
    S.compare = cleanEntries(await store.get('compare', []), { needCarId: true }); S.saved = cleanEntries(await store.get('saved', []));
    const theme = await store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
    $('apiBase').value = S.cfg.apiBase; $('siteBase').value = S.cfg.siteBase; $('origin').textContent = location.origin; checkConn();
  }
  S.scan = null; S.vehicle = null; S.match = null; S.car = null; S.panel = ''; render();
  S.scan = await scan(); S.vehicle = S.scan.vehicles[0] || null; render();
  if (S.vehicle) resolveMatch(S.vehicle);
}
init();
