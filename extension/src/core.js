// Pure helpers and the API client. No DOM, no chrome.* here, so everything is unit-testable.
export const DEFAULTS = { apiBase: 'http://127.0.0.1:8000', siteBase: 'http://localhost:5173' };   // dev only; change in the popup's Settings
export const MAX_COMPARE = 4;                                                                      // same limit as the website
const AUTOMATIC = /\b(automatic|amt|cvt|dct|dsg)\b/i;
const MAKE_ALIASES = { maruti: 'Maruti Suzuki' };

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function makeApi(base, fetchFn = (...a) => fetch(...a), timeoutMs = 10000) {
  async function call(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(base + path, body === undefined ? { signal: ctrl.signal, headers: { Accept: 'application/json' } }
        : { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
    } catch (e) {
      throw new ApiError(e.name === 'AbortError' ? 'The CarSage server took too long to answer.' : 'Cannot reach the CarSage server. Is the API running? (A server error can also look like this when the API sends no CORS headers: check the API log.)', 0);
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try { const b = await res.json(); detail = typeof b.detail === 'string' ? b.detail : (b.detail && b.detail[0] && b.detail[0].msg) || detail; } catch { /* keep generic */ }
      throw new ApiError(detail, res.status);
    }
    try { return await res.json(); } catch { throw new ApiError('The server sent an invalid response.', res.status); }
  }
  const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')).toString();
  return {
    health: () => call('/api/health'),
    search: (q) => call('/api/cars' + qs({ q, page_size: 8 })),
    filters: (make) => call('/api/filters' + qs({ make })),
    match: (v) => call('/api/catalogue/match', v),
    history: (q) => call('/api/price-history/query', q),
    compareLive: (body) => call('/api/prices/compare-live', body),
    recommend: (prefs) => call('/api/recommendations', prefs),
  };
}

// Longest catalogue make at the start of the title, then the longest catalogue model after it; the rest is the variant.
export function splitTitle(title, makes, models = []) {
  const norm = (s) => s.toLowerCase().replace(/[-\s]+/g, ' ').trim();
  const words = title.replace(/^(?:19|20)\d{2}\s+/, '').split(/\s+/).filter(Boolean);
  const longest = (list, from) => {
    const byName = new Map(list.map((x) => [norm(x), x]));
    for (let n = Math.min(4, words.length - from); n >= 1; n--) {
      const hit = byName.get(norm(words.slice(from, from + n).join(' ')));
      if (hit) return { value: hit, next: from + n };
    }
    return null;
  };
  const alias = MAKE_ALIASES[norm(words[0] || '')];
  const mk = longest(makes, 0) || (alias && makes.includes(alias) ? { value: alias, next: 1 } : null);
  if (!mk) return { make: null, model: null, variant: null };
  const md = longest(models, mk.next);
  const variant = words.slice(md ? md.next : mk.next).join(' ');
  return { make: mk.value, model: md ? md.value : null, variant: variant || null };
}

export const compareUrl = (siteBase, ids) =>
  ids.length >= 2 && ids.length <= MAX_COMPARE && new Set(ids).size === ids.length && ids.every((i) => Number.isSafeInteger(i) && i > 0)
    ? `${siteBase}/compare?ids=${ids.join(',')}` : null;

export const carUrl = (siteBase, id) => `${siteBase}/cars/${id}`;

// Preferences for POST /api/recommendations, built from a catalogue car and the user's ticked options.
export function altPrefs(car, { budgetInr, sameFuel, sameBody, sameTransmission }) {
  const t = car.transmission || '';
  return {
    max_price: budgetInr || car.price_inr,
    fuel_types: sameFuel && car.fuel_type ? [car.fuel_type] : [],
    body_types: sameBody && car.body_type ? [car.body_type] : [],
    transmissions: sameTransmission && t ? [AUTOMATIC.test(t) ? 'automatic' : 'manual'] : [],
    limit: 10,
  };
}

// Points -> SVG coordinates. Honest scaling: one point stays one point, no smoothing or filling between observations.
export function chartPoints(observations, w, h, pad = 12) {
  const pts = observations.map((o) => ({ t: Date.parse(o.observed_at), v: o.price_inr, o })).filter((p) => Number.isFinite(p.t) && p.v > 0).sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  const [t0, t1] = [pts[0].t, pts[pts.length - 1].t], vs = pts.map((p) => p.v), [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  return pts.map((p) => ({ x: t1 === t0 ? w / 2 : pad + ((p.t - t0) / (t1 - t0)) * (w - 2 * pad), y: hi === lo ? h / 2 : h - pad - ((p.v - lo) / (hi - lo)) * (h - 2 * pad), obs: p.o }));
}

export const inr = (v) => (v == null ? '—' : v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} crore` : `₹${(v / 1e5).toFixed(2)} lakh`);
export const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

// Stored lists can be stale or hand-edited: keep only well-formed entries so the popup never crashes on them.
export const cleanEntries = (v, { needCarId = false } = {}) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x === 'object' && typeof x.label === 'string' && x.label
  && typeof x.site === 'string' && typeof x.observedAt === 'string' && (x.priceInr == null || Number.isFinite(x.priceInr)) && (needCarId ? Number.isSafeInteger(x.carId) && x.carId > 0 : x.carId == null || Number.isSafeInteger(x.carId))
  && (x.sourceUrl == null || typeof x.sourceUrl === 'string'));

export const LIVE_CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad', 'Chandigarh', 'Jaipur'];

// Request body for /api/prices/compare-live. Identity comes from the listing itself (variant, fuel, transmission, engine, year, status); the catalogue car
// is not used for variant/fuel because the catalogue is an older generation. `city` is the user's choice, never assumed.
export function liveRequest(v, car, { refresh = false, city = '', priceType = '', fuel = '', gear = '' } = {}) {
  const nice = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined);
  return { vehicle: { make: v.make || (car && car.make), model: v.model || (car && car.model), variant: v.variant || undefined, fuel_type: fuel || v.fuelType || undefined, transmission: nice(gear || v.transmission || undefined),
    engine_cc: v.displacementCc || undefined, model_year: v.modelYear || undefined, city: city || undefined, vehicle_status: v.status === 'used' ? 'used' : 'new' },
    source_url: v.canonicalUrl || v.url, displayed_price_inr: v.priceInr || undefined, displayed_price_type: v.priceType === 'used_asking' ? 'unknown' : v.priceType || 'unknown',
    displayed_price_city: v.priceCity || undefined, displayed_price_national_average: !!v.priceNationalAverage,
    preferred_price_type: priceType || (v.priceType === 'on_road' ? 'on_road' : 'ex_showroom'), refresh };
}

const lakh = (n) => `₹${(n / 1e5).toFixed(2)} lakh`;
const when = (q) => (q.retrieved_at || '').slice(0, 16).replace('T', ' ');

// Min–max price per website within one price basis (the first basis that has quotes), for a page that names a model but no variant.
function ranges(quotes) {
  const by = new Map();
  for (const q of quotes) { const k = q.provider + '|' + q.basis.code; const e = by.get(k) || { provider: q.provider, label: q.basis_label, low: Infinity, high: 0, n: 0, urls: new Set() }; e.low = Math.min(e.low, q.price_inr); e.high = Math.max(e.high, q.price_inr); if (!e.urls.has(q.source_url)) { e.urls.add(q.source_url); e.n++; } by.set(k, e); }
  return [...by.values()].filter((e) => e.n).sort((a, b) => a.label.localeCompare(b.label) || a.provider.localeCompare(b.provider));
}

// Display model for the popup. Quotes are shown per price basis; a "cheapest" claim is made only inside one basis with two or more providers.
export function liveSummary(r) {
  const groups = (r.comparable_groups || []).map((g) => ({
    label: g.basis_label, type: g.price_type, multi: !!g.comparable_across_providers, providers: g.providers,
    rows: g.quotes.map((q) => ({ provider: q.provider, vehicle: q.vehicle, price: q.price_inr, freshness: q.freshness, match: q.match, evidence: q.match_evidence, retrieved: when(q), url: q.source_url, lowest: q === g.lowest || (q.provider === g.lowest.provider && q.source_url === g.lowest.source_url && q.price_inr === g.lowest.price_inr) })),
  }));
  const low = r.lowest_comparable;
  const lowGroup = low && (r.comparable_groups || []).find((g) => g.basis.code === low.basis.code);
  const claim = !low ? null : lowGroup.comparable_across_providers ? ((lowGroup.tied_lowest_providers || []).length > 1 ? `Same price on ${lowGroup.tied_lowest_providers.join(' and ')} (${low.basis_label}): ${lakh(low.price_inr)}`
      : `Lowest comparable quote (${low.basis_label}): ${low.provider} at ${lakh(low.price_inr)}`)
    : `Only ${low.provider} returned an exact ${low.basis_label} quote: no "cheapest across websites" claim is possible.`;
  const diff = r.difference_from_displayed_inr;
  return {
    groups, claim, incompatible: r.incompatible_bases || null,
    diff: diff == null ? null : diff === 0 ? 'same as this page (same basis)' : `${diff < 0 ? '−' : '+'}${lakh(Math.abs(diff))} vs this page (same basis)`,
    savings: r.savings_inr ? `Saves ${lakh(r.savings_inr)} compared with this page, same price basis` : null,
    probable: (r.probable_quotes || []).map((q) => ({ provider: q.provider, vehicle: q.vehicle, price: q.price_inr, label: q.basis_label, why: q.match_evidence, url: q.source_url, retrieved: when(q), freshness: q.freshness })),
    modelLevel: (r.model_level || []).map((m) => ({ provider: m.provider, low: m.price_low, high: m.price_high, label: m.basis_label, url: m.source_url, note: m.note, freshness: m.freshness })),
    failures: (r.provider_failures || []).map((f) => `${f.provider} (${f.page}): ${f.error}${f.retry_after_s ? ` - retry in about ${Math.ceil(f.retry_after_s)} s` : ''}${f.served === 'stale' ? ' (an older copy is shown)' : ''}`),
    retryAfter: Math.max(0, ...(r.provider_failures || []).filter((f) => f.kind === 'rate_limited' || f.kind === 'queue_full').map((f) => f.retry_after_s || 0)),
    ranges: ranges(r.quotes || []),
    warnings: r.warnings || [], ambiguous: (r.quotes || []).filter((q) => q.match === 'ambiguous').length,
  };
}
