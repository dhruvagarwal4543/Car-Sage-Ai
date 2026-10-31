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
