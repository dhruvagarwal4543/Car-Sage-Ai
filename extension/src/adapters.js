/* Page detection. A classic script: injected into the active tab on demand (activeTab + scripting) and required by the tests.
   Nothing here runs unless the user opens the popup. Rules below come from reading real public CarDekho and CarWale pages (see tests/fixtures/README.md). */
(function (root) {
  const SITES = [
    { name: 'CarDekho', host: /(^|\.)cardekho\.com$/i, used: /\/used[-/]/i },
    { name: 'CarWale', host: /(^|\.)carwale\.com$/i, used: /\/used\//i },
  ];
  const FUELS = { petrol: 'Petrol', gasoline: 'Petrol', diesel: 'Diesel', cng: 'CNG', electric: 'Electric', hybrid: 'Hybrid' };
  const text = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const flat = (v) => [].concat(v ?? []).flatMap((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && x.name ? x.name : []));   // strings or {name}
  const nameOf = (v) => flat(first(v))[0] || null;
  const distinct = (a) => [...new Set(a)];
  const stripYear = (s) => s.replace(/^(?:19|20)\d{2}\s+/, '').replace(/\s*\[[^\]]*\]/, '').trim();
  const sameUrl = (a, b) => { try { const f = (u) => { const x = new URL(u); return (x.host + x.pathname).toLowerCase().replace(/\/+$/, ''); }; return f(a) === f(b); } catch { return false; } };

  // "₹ 11.11 - 20.42 Lakh" -> 1111000 (the unit at the end of a range belongs to both numbers). Returns { inr, range }.
  function parsePrice(s) {
    const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakhs?|lacs?)?\s*(?:(?:-|–|to)\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakhs?|lacs?)?)?/i.exec(s || '');
    if (!m) return null;
    const unit = (m[2] || m[4] || '').toLowerCase();
    const inr = Math.round(parseFloat(m[1].replace(/,/g, '')) * (unit.startsWith('c') ? 1e7 : unit ? 1e5 : 1));
    return inr > 0 ? { inr, range: m[3] !== undefined } : null;
  }

  function cleanTitle(s) {
    return s.replace(/\s*[|\-–]\s*(CarDekho|CarWale)[^|]*$/i, '').split(/\s+(?:price|mileage|specs?|reviews?|images?|colou?rs?)\b/i)[0].trim();
  }

  // The first price that sits next to an "Ex-Showroom"/"On-Road" label decides both value and type. "Get On-Road Price" is a button, not a label.
  // A second price glued to the first (two fuel columns) means the page shows a spread, so the figure is a starting price.
  function labelledPrice(doc) {
    const body = doc.body && doc.body.cloneNode(true);
    if (!body) return null;
    body.querySelectorAll('script,style,noscript').forEach((e) => e.remove());
    const t = text(body).replace(/get on-?road price/gi, ' ');
    const re = /(?:₹|Rs\.?)\s*[\d,]+(?:\.\d+)?(?:\s*(?:-|–|to)\s*(?:₹|Rs\.?)?\s*[\d,]+(?:\.\d+)?)?\s*(?:Lakh|Crore|Cr)?/gi;
    let m, n = 0;
    while ((m = re.exec(t)) && n++ < 60) {
      const before = t.slice(Math.max(0, m.index - 60), m.index), after = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
      const dist = (rx) => { const b = [...before.matchAll(rx)].pop(), a = rx.exec(after); return Math.min(b ? before.length - b.index - b[0].length : 1e9, a ? a.index : 1e9); };   // characters between the label and the price
      const ex = dist(/ex-?showroom/gi), on = dist(/on-?road/gi);
      if (ex === 1e9 && on === 1e9) continue;
      const p = parsePrice(m[0]);
      if (p && (/lakh|crore|cr/i.test(m[0]) || p.inr >= 100000)) return { inr: p.inr, type: ex <= on ? 'ex_showroom' : 'on_road', range: p.range || /^\s*(?:₹|Rs\.?)/i.test(after) };
    }
    return null;
  }

  function ldNodes(doc) {
    const out = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      out.push(n); walk(n['@graph']); walk(n.itemListElement); walk(n.item); walk(n.mainEntity);
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { walk(JSON.parse(s.textContent)); } catch { /* malformed block: skip */ } });
    return out;
  }

  const single = (list) => (list.length === 1 ? list[0] : null);
  const fuelOf = (words) => distinct(words.flatMap((w) => String(w).toLowerCase().match(/\b(petrol|gasoline|diesel|cng|electric|hybrid)\b/g) || []).map((w) => FUELS[w]));
  const gearOf = (words) => {
    const t = words.join(' ').toLowerCase(), auto = /\b(automatic|amt|cvt|dct|dsg|at)\b/.test(t), man = /\bmanual|\bmt\b/.test(t);
    return auto && man ? ['Manual', 'Automatic'] : auto ? ['Automatic'] : man ? ['Manual'] : [];
  };

  function fromJsonLd(n) {
    const offer = first(n.offers) || {};
    const low = Number(offer.price ?? offer.lowPrice), high = Number(offer.highPrice);
    const inrOk = !offer.priceCurrency || offer.priceCurrency === 'INR';      // never treat another currency as rupees
    const odo = first(n.mileageFromOdometer) || {};
    const engines = [].concat(n.vehicleEngine || []).filter((e) => e && typeof e === 'object');
    const img = first(n.image);
    const addr = (offer.availableAtOrFrom && offer.availableAtOrFrom.address) || {};
    return {
      title: String(n.name), nodeUrl: n.url || null, make: nameOf(n.brand) || nameOf(n.manufacturer), model: nameOf(n.model),
      image: typeof img === 'string' ? img : img && img.url,
      priceInr: inrOk && low > 0 ? Math.round(low) : null, priceIsRange: inrOk && high > low, priceContext: offer.description || '',
      fuels: fuelOf(flat(n.fuelType ?? n.fueltype).concat(engines.flatMap((e) => flat(e.fuelType)))), gears: gearOf(flat(n.vehicleTransmission)),
      displacements: distinct(engines.map((e) => Number(first(e.engineDisplacement) && first(e.engineDisplacement).value)).filter((v) => v > 0)),
      mileage: [].concat(n.fuelEfficiency || []).map((q) => ({ label: q && q.name, value: Number(q && q.value), unit: (q && (q.unitText || q.unitCode)) || '' })).filter((q) => Number.isFinite(q.value) && q.value > 0),
      modelYear: Number(n.vehicleModelDate || n.modelDate || String(n.productionDate || '').slice(0, 4)) || null,
      odometerKm: /^(KMT|km)$/i.test(odo.unitCode || odo.unitText || '') && Number(odo.value) >= 0 ? Number(odo.value) : null,
      location: addr.addressLocality || null, condition: String(n.itemCondition || ''), source: 'json-ld',
    };
  }

  function fromDom(doc) {
    const og = (p) => (doc.querySelector(`meta[property="og:${p}"]`) || {}).content || '';
    const title = text(doc.querySelector('h1')) || og('title');
    if (!title) return null;
    const el = [...doc.querySelectorAll('[class*="price" i], [data-testid*="price" i]')].find((e) => parsePrice(text(e)));
    const p = el && parsePrice(text(el));
    return { title, image: og('image'), priceInr: p && p.inr, priceIsRange: p && p.range, priceContext: el ? text(el.parentElement || el).slice(0, 200) : '', fuels: [], gears: [], displacements: [], mileage: [], source: 'dom' };
  }

  function finish(b, ctx) {
    const { site, url, canonical, status, labelled, crumb } = ctx;
    let title = cleanTitle(b.title);
    const core = stripYear(title).toLowerCase();
    const h1 = ctx.h1 && stripYear(ctx.h1);
    if (h1 && h1.toLowerCase().startsWith(core) && h1.length > core.length) title = cleanTitle(ctx.h1);       // CarWale used: heading carries the variant, JSON-LD only the model
    if (crumb && stripYear(crumb.title).toLowerCase().startsWith(core)) title = (/^(?:19|20)\d{2}\s/.exec(title) || [''])[0] + crumb.title;   // CarDekho used: breadcrumb carries the variant
    const year = b.modelYear || (/\b((?:19|20)\d{2})\b/.exec(title) || [])[1];
    const ex = status === 'new' && labelled;
    // The page rounds to lakhs; the structured price is exact. Keep the exact one when it is the same figure.
    const priceInr = ex ? (b.priceInr && Math.abs(b.priceInr - labelled.inr) <= 5000 ? b.priceInr : labelled.inr) : b.priceInr, ctxText = b.priceContext || '';
    const gears = b.gears.length ? b.gears : gearOf([title]), fuels = b.fuels.length ? b.fuels : fuelOf([title]);
    return {
      site: site ? site.name : new URL(url).hostname, url, canonicalUrl: canonical, title, make: b.make || null, model: b.model || null,
      modelYear: year ? Number(year) : null, status, image: b.image || null, location: b.location || (crumb && crumb.location) || null,
      priceInr: priceInr || null, priceIsRange: ex ? labelled.range || !!b.priceIsRange : !!b.priceIsRange,
      priceType: !priceInr ? 'unknown' : status === 'used' ? 'used_asking' : ex ? labelled.type : /ex[- ]?showroom/i.test(ctxText) ? 'ex_showroom' : /on[- ]?road/i.test(ctxText) ? 'on_road' : 'unknown',
      fuelType: single(fuels), fuelOptions: fuels, transmission: single(gears), transmissionOptions: gears,
      displacementCc: single(b.displacements), mileage: b.mileage, odometerKm: b.odometerKm ?? null, source: b.source, confidence: ctx.confidence,
    };
  }

  // -> { supported, site, vehicles: [normalized vehicle], reason }. Never throws on odd markup.
  function detect(doc, url) {
    let u;
    try { u = new URL(url); } catch { return { supported: false, site: null, vehicles: [], reason: 'Not a web page.' }; }
    const site = SITES.find((s) => s.host.test(u.hostname));
    const nodes = ldNodes(doc);
    const wanted = site ? /^(Car|Vehicle|Product)$/i : /^(Car|Vehicle)$/i;   // unknown sites: a bare Product could be anything
    const seen = new Set();
    let cands = nodes.filter((n) => n.name && [].concat(n['@type'] || []).some((t) => wanted.test(t))).map(fromJsonLd)
      .filter((b) => !seen.has(b.title + b.priceInr) && seen.add(b.title + b.priceInr));
    const h1 = cleanTitle(text(doc.querySelector('h1')));
    const canonical = ((doc.querySelector('link[rel="canonical"]') || {}).href || '') || null;
    // A page can describe several cars (related models, a wrong variant). The page's own car is the one whose URL or title is the page's.
    const own = cands.filter((b) => (b.nodeUrl && (sameUrl(b.nodeUrl, url) || (canonical && sameUrl(b.nodeUrl, canonical)))) || (h1 && stripYear(cleanTitle(b.title)).toLowerCase() === stripYear(h1).toLowerCase()));
    const matched = own.length > 0;
    if (matched) cands = own.slice(0, 1);
    const usedPage = !!site && site.used.test(u.pathname);
    const crumb = (() => {   // CarDekho used: "Used Hyundai Creta SX Diesel BSVI Cars in New Delhi"
      const hit = nodes.map((n) => /^Used (.+?) Cars in (.+)$/i.exec(String(n.name || ''))).filter(Boolean).sort((a, b) => b[1].length - a[1].length)[0];
      return hit ? { title: hit[1], location: hit[2] } : null;
    })();
    let vehicles = cands.map((b) => {
      const status = usedPage || /used/i.test(b.condition) || b.odometerKm != null ? 'used' : 'new';
      const conf = b.make && b.model && site && (matched || cands.length === 1) ? 'high' : matched || !site ? 'medium' : 'low';
      return finish(b, { site, url, canonical, status, h1, crumb: status === 'used' ? crumb : null, labelled: status === 'new' && site && cands.length === 1 ? labelledPrice(doc) : null, confidence: conf });
    });
    if (!vehicles.length && site) {
      const b = fromDom(doc);
      if (b) vehicles = [finish(b, { site, url, canonical, status: usedPage ? 'used' : 'new', h1: null, crumb: null, labelled: usedPage ? null : labelledPrice(doc), confidence: 'low' })];
    }
    if (!vehicles.length) return { supported: !!site, site: site ? site.name : null, vehicles: [], reason: site ? 'No vehicle found on this page. Open a car or variant page.' : 'This site has no machine-readable car data, so it is not supported.' };
    return { supported: true, site: site ? site.name : u.hostname, vehicles, reason: null };
  }

  const api = { detect, parsePrice, cleanTitle, labelledPrice };
  root.CarSageAdapters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
