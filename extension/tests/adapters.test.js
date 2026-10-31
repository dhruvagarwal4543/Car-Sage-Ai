import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { detect, parsePrice, labelledPrice } = createRequire(import.meta.url)('../src/adapters.js');

// Hand-written fixtures shaped like typical pages. They are NOT captures of the live sites.
const page = (head = '', body = '') => new DOMParser().parseFromString(`<html><head>${head}</head><body>${body}</body></html>`, 'text/html');
const ld = (o) => `<script type="application/ld+json">${typeof o === 'string' ? o : JSON.stringify(o)}</script>`;
const creta = { '@type': 'Car', name: 'Hyundai Creta SX Diesel', brand: { name: 'Hyundai' }, model: 'Creta', image: ['https://img.example/creta.jpg'], fuelType: 'Diesel',
  vehicleTransmission: 'Automatic', offers: { price: 1750000, priceCurrency: 'INR', description: 'Ex-showroom price' } };

describe('site matching and JSON-LD', () => {
  it('reads a CarDekho new-car page from structured data', () => {
    const r = detect(page(ld(creta)), 'https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta.htm');
    expect(r.supported).toBe(true); expect(r.site).toBe('CarDekho');
    expect(r.vehicles[0]).toMatchObject({ status: 'new', priceInr: 1750000, priceType: 'ex_showroom', fuelType: 'Diesel', transmission: 'Automatic', make: 'Hyundai', confidence: 'high', source: 'json-ld' });
  });
  it('reports an unknown price type instead of guessing', () => {
    const r = detect(page(ld({ ...creta, offers: { price: 1750000, priceCurrency: 'INR' } })), 'https://www.carwale.com/hyundai-cars/creta/');
    expect(r.vehicles[0].priceType).toBe('unknown');
  });
  it('never treats another currency as rupees', () => {
    const r = detect(page(ld({ ...creta, offers: { price: 30000, priceCurrency: 'USD' } })), 'https://www.cardekho.com/x');
    expect(r.vehicles[0].priceInr).toBeNull();
  });
  it('marks used listings with an asking price and odometer', () => {
    const used = { ...creta, name: '2019 Hyundai Creta SX', itemCondition: 'https://schema.org/UsedCondition', mileageFromOdometer: { value: 42000, unitCode: 'KMT' }, offers: { price: 900000, priceCurrency: 'INR' } };
    const v = detect(page(ld(used)), 'https://www.carwale.com/used/hyundai-creta-1234/').vehicles[0];
    expect(v).toMatchObject({ status: 'used', priceType: 'used_asking', odometerKm: 42000, modelYear: 2019 });
  });
  it('lists several cars on one page and removes duplicates', () => {
    const list = { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: creta }, { item: { ...creta, name: 'Kia Seltos HTK', brand: 'Kia' } }, { item: creta }] };
    expect(detect(page(ld(list)), 'https://www.cardekho.com/cars').vehicles.map((v) => v.title)).toEqual(['Hyundai Creta SX Diesel', 'Kia Seltos HTK']);
  });
  it('skips malformed JSON-LD without throwing', () => {
    const r = detect(page(ld('{not json') + ld(creta)), 'https://www.cardekho.com/x');
    expect(r.vehicles).toHaveLength(1);
  });
});

describe('DOM fallback and unsupported pages', () => {
  it('uses the heading and a price range on a known site, with low confidence', () => {
    const doc = page('<meta property="og:image" content="https://img.example/a.jpg">', '<h1>Hyundai Creta Price, Images, Colours & Reviews</h1><div>Ex-showroom price<span class="price-box">₹ 11.11 - 20.42 Lakh</span></div>');
    const v = detect(doc, 'https://www.carwale.com/hyundai-cars/creta/').vehicles[0];
    expect(v).toMatchObject({ title: 'Hyundai Creta', priceInr: 1111000, priceIsRange: true, priceType: 'ex_showroom', confidence: 'low', source: 'dom', image: 'https://img.example/a.jpg' });
  });
  it('says so when a known site page has no car', () => {
    const r = detect(page('', '<p>Hello</p>'), 'https://www.cardekho.com/');
    expect(r).toMatchObject({ supported: true, vehicles: [] }); expect(r.reason).toMatch(/No vehicle/);
  });
  it('rejects unknown sites without car metadata, including a bare Product', () => {
    expect(detect(page('', '<h1>Hyundai Creta</h1>'), 'https://example.com/car').supported).toBe(false);
    expect(detect(page(ld({ '@type': 'Product', name: 'Phone', offers: { price: 5 } })), 'https://example.com/p').supported).toBe(false);
  });
  it('accepts an unknown site only with Car metadata, at medium confidence', () => {
    const v = detect(page(ld(creta)), 'https://cars.example.org/creta').vehicles[0];
    expect(v.confidence).toBe('medium'); expect(v.site).toBe('cars.example.org');
  });
  it('handles a non-URL', () => { expect(detect(page(), 'about:blank').supported).toBe(false); });
});

describe('parsePrice', () => {
  it.each([['₹ 12.5 Lakh', 1250000, false], ['Rs. 1.2 Crore', 12000000, false], ['₹ 11.11 - 20.42 Lakh', 1111000, true], ['₹10,50,000', 1050000, false]])('%s', (s, inr, range) => {
    expect(parsePrice(s)).toEqual({ inr, range });
  });
  it('returns null without a currency marker', () => { expect(parsePrice('1.5 L diesel')).toBeNull(); });
});

// ---- real public pages (trimmed snapshots, see tests/fixtures/README.md) ----
const FIX = join(process.cwd(), 'tests/fixtures');   // tests run from extension/
const sources = JSON.parse(readFileSync(join(FIX, 'sources.json'), 'utf8'));
const real = (name) => {
  const html = readFileSync(join(FIX, `${name}.html`), 'utf8');
  const r = detect(new DOMParser().parseFromString(html, 'text/html'), sources[`${name}.html`]);
  return r.vehicles;
};

describe('real CarDekho pages', () => {
  it('model page: starting ex-showroom price, many fuels, nothing guessed', () => {
    const [v] = real('cardekho-model');
    expect(v).toMatchObject({ title: 'Hyundai Creta', status: 'new', priceInr: 1090700, priceIsRange: true, priceType: 'ex_showroom', fuelType: null, fuelOptions: ['Petrol', 'Diesel'], transmission: null, displacementCc: null, confidence: 'high', canonicalUrl: 'https://www.cardekho.com/hyundai/creta' });
    expect(v.mileage).toEqual([{ label: 'Diesel', value: 21.8, unit: 'kmpl' }, { label: 'Petrol', value: 17.4, unit: 'kmpl' }]);
  });
  it('variant page: ignores the JSON-LD car of a different variant and reads the exact ex-showroom price', () => {
    const vs = real('cardekho-variant');
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ title: 'Hyundai Creta E', priceInr: 1090700, priceIsRange: false, priceType: 'ex_showroom', confidence: 'medium' });
    expect(vs[0].title).not.toMatch(/S \(O\)/);
  });
  it('used page: asking price, odometer, fuel, gearbox, city and the variant from the breadcrumb', () => {
    const [v] = real('cardekho-used');
    expect(v).toMatchObject({ title: '2021 Hyundai Creta SX Diesel BSVI', status: 'used', modelYear: 2021, priceInr: 1190000, priceType: 'used_asking', odometerKm: 50000, fuelType: 'Diesel', transmission: 'Manual', location: 'New Delhi' });
  });
});

describe('real CarWale pages', () => {
  it('model page: starting price from the aggregate offer', () => {
    const [v] = real('carwale-model');
    expect(v).toMatchObject({ title: 'Hyundai Creta', status: 'new', modelYear: 2024, priceInr: 1090692, priceIsRange: true, priceType: 'ex_showroom', fuelType: null, confidence: 'high' });
  });
  it('variant page: the JSON-LD price is the Mumbai on-road price and must not be shown as ex-showroom', () => {
    const [v] = real('carwale-variant');
    expect(v).toMatchObject({ title: 'Hyundai Creta E', priceInr: 1091000, priceType: 'ex_showroom', priceIsRange: true });   // two fuel columns: a starting price
    expect(v.priceInr).not.toBe(1308385);
  });
  it('used page: heading carries the variant, odometer is read from a list, city from the offer', () => {
    const [v] = real('carwale-used');
    expect(v).toMatchObject({ title: '2022 Hyundai Creta EX 1.5 Diesel', status: 'used', priceInr: 1190000, priceType: 'used_asking', odometerKm: 50757, fuelType: 'Diesel', transmission: 'Manual', location: 'Nagpur', modelYear: 2022 });
  });
});

describe('labelled price rules', () => {
  const t = (body) => labelledPrice(new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html'));
  it('ignores promo amounts and the "Get On-Road Price" button', () => {
    expect(t('Rate & Win ₹1000 Rs.10.91 Lakh*Get On-Road Price*Ex-Showroom Price in New Delhi')).toMatchObject({ inr: 1091000, type: 'ex_showroom' });
  });
  it('picks the label nearest to the price and flags glued prices as a spread', () => {
    expect(t('Ex-Showroom PriceRs. 10.91 LakhRs. 12.61 LakhOn-Road Price, MumbaiRs. 13.08 Lakh')).toEqual({ inr: 1091000, type: 'ex_showroom', range: true });
    expect(t('On-Road Price, Mumbai Rs. 13.08 Lakh')).toMatchObject({ inr: 1308000, type: 'on_road' });
  });
  it('returns nothing when no price sits next to a label', () => { expect(t('Creta E price starts at Rs. 13.08 Lakh')).toBeNull(); });
});
