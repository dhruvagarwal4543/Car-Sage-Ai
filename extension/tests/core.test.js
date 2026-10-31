import { ApiError, MAX_COMPARE, altPrefs, chartPoints, cleanEntries, compareUrl, inr, makeApi, safeUrl, splitTitle } from '../src/core.js';

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
