import { ApiError, MAX_COMPARE, altPrefs, chartPoints, cleanEntries, compareUrl, inr, LIVE_CITIES, liveRequest, liveSummary, makeApi, safeUrl, splitTitle } from '../src/core.js';

const makes = ['Hyundai', 'Maruti Suzuki', 'Mercedes-Benz', 'Kia'];
const models = ['Creta', 'Swift', 'Swift Dzire', 'E-Class'];

describe('splitTitle', () => {
  it('splits make, model and variant against catalogue names', () => {
    expect(splitTitle('2023 Hyundai Creta SX Diesel', makes, models)).toEqual({ make: 'Hyundai', model: 'Creta', variant: 'SX Diesel' });
  });
  it('prefers the longest model and handles multi-word makes and aliases', () => {
    expect(splitTitle('Maruti Suzuki Swift Dzire VXi', makes, models)).toMatchObject({ make: 'Maruti Suzuki', model: 'Swift Dzire', variant: 'VXi' });
    expect(splitTitle('Maruti Swift LXi', makes, models)).toMatchObject({ make: 'Maruti Suzuki', model: 'Swift' });
    expect(splitTitle('Mercedes Benz E-Class', makes, models)).toMatchObject({ make: 'Mercedes-Benz', model: 'E-Class', variant: null });
  });
  it('does not guess when the make is unknown, or the model is missing', () => {
    expect(splitTitle('Foo Bar 1.0', makes, models)).toEqual({ make: null, model: null, variant: null });
    expect(splitTitle('Kia Unknown GT', makes, models)).toEqual({ make: 'Kia', model: null, variant: 'Unknown GT' });
  });
});

describe('compareUrl', () => {
  it('builds the website route /compare?ids=', () => { expect(compareUrl('http://site', [3, 7])).toBe('http://site/compare?ids=3,7'); });
  it.each([[[1]], [[1, 1]], [[1, 2, 3, 4, 5]], [[1, -2]], [[1, 1.5]], [[]]])('refuses %j', (ids) => { expect(compareUrl('http://site', ids)).toBeNull(); });
  it('matches the website limit', () => { expect(MAX_COMPARE).toBe(4); });
});

describe('altPrefs', () => {
  const car = { price_inr: 1500000, fuel_type: 'Diesel', body_type: 'SUV', transmission: 'AMT' };
  it('uses the car price as the default budget and only ticked constraints', () => {
    expect(altPrefs(car, {})).toMatchObject({ max_price: 1500000, fuel_types: [], body_types: [], transmissions: [] });
    expect(altPrefs(car, { budgetInr: 1200000, sameFuel: true, sameBody: true, sameTransmission: true })).toMatchObject({ max_price: 1200000, fuel_types: ['Diesel'], body_types: ['SUV'], transmissions: ['automatic'] });
  });
  it('maps a manual gearbox', () => { expect(altPrefs({ ...car, transmission: 'Manual' }, { sameTransmission: true }).transmissions).toEqual(['manual']); });
});

describe('chartPoints', () => {
  const o = (d, v) => ({ observed_at: d, price_inr: v });
  it('sorts by time and scales into the box', () => {
    const p = chartPoints([o('2025-06-01T00:00:00Z', 200), o('2024-06-01T00:00:00Z', 100)], 100, 50, 0);
    expect(p.map((x) => [x.x, x.y])).toEqual([[0, 50], [100, 0]]);
  });
  it('keeps one observation as one point, never a line', () => { expect(chartPoints([o('2025-01-01T00:00:00Z', 5)], 100, 50)).toMatchObject([{ x: 50, y: 25 }]); });
  it('drops invalid points and handles empty input', () => {
    expect(chartPoints([o('nonsense', 5), o('2025-01-01T00:00:00Z', 0)], 100, 50)).toEqual([]);
    expect(chartPoints([], 100, 50)).toEqual([]);
  });
});

describe('makeApi', () => {
  const res = (status, body, raw) => ({ ok: status < 400, status, json: async () => { if (raw) throw new Error('bad'); return body; } });
  it('returns JSON and posts a body', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: 1 }));
    expect(await makeApi('http://api', f).match({ make: 'A', model: 'B' })).toEqual({ ok: 1 });
    expect(f.mock.calls[0][0]).toBe('http://api/api/catalogue/match'); expect(f.mock.calls[0][1].method).toBe('POST');
  });
  it('builds a search query and omits empty params', async () => {
    const f = vi.fn().mockResolvedValue(res(200, {}));
    await makeApi('http://api', f).filters(undefined); await makeApi('http://api', f).search('nexon ev');
    expect(f.mock.calls[0][0]).toBe('http://api/api/filters?'); expect(f.mock.calls[1][0]).toContain('q=nexon+ev');
  });
  it('turns server errors into readable ApiErrors', async () => {
    await expect(makeApi('http://a', async () => res(404, { detail: 'car not found' })).health()).rejects.toMatchObject({ message: 'car not found', status: 404 });
    await expect(makeApi('http://a', async () => res(422, { detail: [{ msg: 'bad year' }] })).health()).rejects.toMatchObject({ message: 'bad year' });
    await expect(makeApi('http://a', async () => res(500, null, true)).health()).rejects.toMatchObject({ message: 'Request failed (500)' });
  });
  it('reports network failure, a bad body and a timeout', async () => {
    await expect(makeApi('http://a', async () => { throw new TypeError('x'); }).health()).rejects.toThrow(/Cannot reach/);
    await expect(makeApi('http://a', async () => res(200, null, true)).health()).rejects.toThrow(/invalid response/);
    const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    await expect(makeApi('http://a', hang, 5).health()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('formatting', () => {
  it('formats rupees', () => { expect(inr(1250000)).toBe('₹12.50 lakh'); expect(inr(25000000)).toBe('₹2.50 crore'); expect(inr(null)).toBe('—'); });
  it('only allows http(s) links and images', () => { expect(safeUrl('javascript:alert(1)')).toBeNull(); expect(safeUrl('https://a.b/c.jpg')).toBe('https://a.b/c.jpg'); });
});

describe('cleanEntries (stale or damaged storage)', () => {
  const ok = { label: 'Hyundai Creta E', site: 'CarDekho', observedAt: '2026-10-30T00:00:00Z', priceInr: 1090700, carId: 5, sourceUrl: 'https://x.y/z' };
  it('keeps good entries', () => { expect(cleanEntries([ok])).toEqual([ok]); });
  it('drops non-lists and malformed entries instead of throwing', () => {
    expect(cleanEntries(undefined)).toEqual([]); expect(cleanEntries('x')).toEqual([]); expect(cleanEntries({ a: 1 })).toEqual([]);
    expect(cleanEntries([null, 3, {}, { ...ok, label: '' }, { ...ok, observedAt: 5 }, { ...ok, priceInr: 'free' }, { ...ok, sourceUrl: 7 }, ok])).toEqual([ok]);
  });
  it('comparison entries need a valid catalogue id, saved ones may lack it', () => {
    const noId = { ...ok, carId: null };
    expect(cleanEntries([noId, { ...ok, carId: -1 }, { ...ok, carId: 1.5 }], { needCarId: true })).toEqual([]);
    expect(cleanEntries([noId])).toEqual([noId]);
  });
});

describe('live price comparison', () => {
  const v = { make: 'Hyundai', model: 'Creta', variant: 'E', fuelType: 'Petrol', transmission: 'manual', displacementCc: 1497, modelYear: 2024, status: 'new', url: 'https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta_E.htm',
    canonicalUrl: 'https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta_E.htm', priceInr: 1090700, priceType: 'ex_showroom', priceCity: 'New Delhi', priceNationalAverage: false };
  it('builds the request from the listing and the user\'s chosen city, never from the old catalogue variant', () => {
    expect(liveRequest(v, { make: 'Hyundai', model: 'Creta', variant: '1.4 Crdi E Plus', fuel_type: 'Diesel' }, { refresh: true, city: 'Mumbai' })).toEqual({
      vehicle: { make: 'Hyundai', model: 'Creta', variant: 'E', fuel_type: 'Petrol', transmission: 'Manual', engine_cc: 1497, model_year: 2024, city: 'Mumbai', vehicle_status: 'new' }, source_url: v.canonicalUrl,
      displayed_price_inr: 1090700, displayed_price_type: 'ex_showroom', displayed_price_city: 'New Delhi', displayed_price_national_average: false, preferred_price_type: 'ex_showroom', refresh: true });
    const bare = liveRequest({ ...v, make: null, model: null, variant: null, fuelType: null, displacementCc: null, priceCity: null }, { make: 'Hyundai', model: 'Creta', variant: '1.4 Crdi E Plus' });
    expect(bare.vehicle).toMatchObject({ make: 'Hyundai', model: 'Creta', variant: undefined, fuel_type: undefined, city: undefined });   // no city is assumed
    expect(liveRequest({ ...v, status: 'used', priceType: 'used_asking' }, null).vehicle.vehicle_status).toBe('used');
    expect(liveRequest(v, null, { priceType: 'on_road' }).preferred_price_type).toBe('on_road');
    expect(liveRequest({ ...v, fuelType: null, transmission: null }, null, { fuel: 'Diesel', gear: 'automatic' }).vehicle).toMatchObject({ fuel_type: 'Diesel', transmission: 'Automatic' });   // the user's choice on a trim page
    expect(liveRequest(v, null, { fuel: 'Diesel' }).vehicle.fuel_type).toBe('Diesel');
    expect(liveRequest({ ...v, priceType: 'on_road' }, null).preferred_price_type).toBe('on_road');
  });
  const basis = (code, label, type = 'ex_showroom') => ({ code, price_type: type, location_kind: 'city', location: code.split('_')[0] });
  const quote = (provider, price, b, extra = {}) => ({ provider, vehicle: 'E', price_inr: price, price_type: b.price_type, basis: b, basis_label: extra.label || 'ex-showroom, Delhi', freshness: 'fresh', match: 'exact', match_evidence: 'ok',
    source_url: `https://${provider}/x`, retrieved_at: '2026-11-12T10:00:00+00:00', ...extra });
  const b1 = basis('DELHI_EX_SHOWROOM');
  it('shows each price basis apart and names the lowest only inside a basis shared by two providers', () => {
    const a = quote('CarDekho', 1090700, b1), c = quote('CarWale', 1095000, b1);
    const s = liveSummary({ comparable_groups: [{ basis: b1, basis_label: 'ex-showroom, Delhi', price_type: 'ex_showroom', quotes: [a, c], lowest: a, providers: ['CarDekho', 'CarWale'], comparable_across_providers: true }], lowest_comparable: a,
      difference_from_displayed_inr: -9300, savings_inr: null, incompatible_bases: null, probable_quotes: [], model_level: [], provider_failures: [], warnings: ['w'], quotes: [a, c] });
    expect(s.groups[0].rows.map((r) => [r.provider, r.lowest])).toEqual([['CarDekho', true], ['CarWale', false]]);
    expect(s.claim).toBe('Lowest comparable quote (ex-showroom, Delhi): CarDekho at ₹10.91 lakh'); expect(s.diff).toBe('−₹0.09 lakh vs this page (same basis)'); expect(s.savings).toBeNull();
  });
  it('says "same price" instead of naming a winner when providers tie', () => {
    const a = quote('CarDekho', 1090700, b1), c = quote('CarWale', 1090700, b1);
    const s = liveSummary({ comparable_groups: [{ basis: b1, basis_label: 'ex-showroom, Delhi', price_type: 'ex_showroom', quotes: [a, c], lowest: a, providers: ['CarDekho', 'CarWale'], tied_lowest_providers: ['CarDekho', 'CarWale'], comparable_across_providers: true }], lowest_comparable: a, quotes: [a, c] });
    expect(s.claim).toBe('Same price on CarDekho and CarWale (ex-showroom, Delhi): ₹10.91 lakh');
  });
  it('refuses a cheapest claim for one source or mixed bases, and reports savings only when the backend does', () => {
    const a = quote('CarDekho', 1090700, b1), nat = basis('NATIONAL_AVERAGE_EX_SHOWROOM'), c = quote('CarWale', 1000000, nat, { label: 'ex-showroom, national average' });
    const s = liveSummary({ comparable_groups: [{ basis: b1, basis_label: 'ex-showroom, Delhi', price_type: 'ex_showroom', quotes: [a], lowest: a, providers: ['CarDekho'], comparable_across_providers: false },
      { basis: nat, basis_label: 'ex-showroom, national average', price_type: 'ex_showroom', quotes: [c], lowest: c, providers: ['CarWale'], comparable_across_providers: false }], lowest_comparable: a,
      incompatible_bases: 'Prices shown are from different location bases and cannot be directly compared.', difference_from_displayed_inr: null, savings_inr: null, quotes: [a, c] });
    expect(s.claim).toMatch(/Only CarDekho returned an exact ex-showroom, Delhi quote: no "cheapest across websites" claim/); expect(s.incompatible).toMatch(/different location bases/); expect(s.groups).toHaveLength(2);
    expect(s.savings).toBeNull();
    expect(liveSummary({ comparable_groups: [], savings_inr: 7788, difference_from_displayed_inr: -7788 }).savings).toBe('Saves ₹0.08 lakh compared with this page, same price basis');
  });
  it('lists probable matches and model-level references apart, with failures and a retry hint', () => {
    const s = liveSummary({ comparable_groups: [], probable_quotes: [{ provider: 'CarDekho', vehicle: 'E', price_inr: 1090700, basis_label: 'ex-showroom, Delhi', match_evidence: 'fuel not stated', source_url: 'https://www.cardekho.com/a', retrieved_at: '', freshness: 'cached' }],
      model_level: [{ provider: 'CarDekho', price_low: 1090700, price_high: 2045700, basis_label: 'ex-showroom, Delhi', source_url: 'u', note: 'model-level reference', freshness: 'fresh' }],
      provider_failures: [{ provider: 'CarWale', page: 'city (Delhi)', error: 'fetch budget used up', kind: 'rate_limited', retry_after_s: 41.2, served: 'stale' }], warnings: [], quotes: [{ match: 'ambiguous' }] });
    expect(s.probable[0]).toMatchObject({ provider: 'CarDekho', why: 'fuel not stated' }); expect(s.modelLevel[0]).toMatchObject({ low: 1090700, high: 2045700 });
    expect(s.failures).toEqual(['CarWale (city (Delhi)): fetch budget used up - retry in about 42 s (an older copy is shown)']); expect(s.retryAfter).toBe(41.2); expect(s.ambiguous).toBe(1);
  });
  it('handles an empty response', () => {
    expect(liveSummary({})).toMatchObject({ groups: [], claim: null, diff: null, savings: null, incompatible: null, failures: [], probable: [], modelLevel: [], retryAfter: 0 });
  });
  it('offers the supported cities', () => { expect(LIVE_CITIES).toContain('Delhi'); expect(LIVE_CITIES).not.toContain('New Delhi'); });
});
