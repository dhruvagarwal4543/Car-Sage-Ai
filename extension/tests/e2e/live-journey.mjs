// Drives a real Chrome (throwaway profile) over CDP: loads the unpacked extension and exercises the popup.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Browser check. Needs Chrome (macOS path below; set CHROME for another), an API on :8000 (see README) and, for e2e2, the seeded SQLite API on :8001.
const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const ID = [...crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32)].map((c) => 'abcdefghijklmnop'['0123456789abcdef'.indexOf(c)]).join('');   // id Chrome gives an unpacked extension
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'carsage-chrome-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });   // throwaway profile; the flag only exists to let automation load an unpacked extension
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };

let nextId = 1, buf = ''; const pending = new Map(); const handlers = [];
async function connect() {
  chrome.stdio[4].on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\0')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); onMessage(m); } });
  await sleep(2000);
}
function onMessage(d) { if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else handlers.forEach((h) => h(d)); }
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0'); });

const consoleErrors = [], dialogs = [];
handlers.push(async (d) => {
  if (d.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErrors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') consoleErrors.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  if (d.method === 'Page.javascriptDialogOpening') { dialogs.push(d.params.message); send('Page.handleJavaScriptDialog', { accept: true }, d.sessionId).catch(() => {}); }
});

async function open(url, stub) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await send(m, {}, sessionId);
  if (stub) await send('Page.addScriptToEvaluateOnNewDocument', { source: stub }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(700);
  return { targetId, sessionId };
}
const ev = async (s, expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s.sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); if (expression.includes('.click()')) await sleep(250); return r.result.value; };   // clicks re-render after an async storage write
async function waitFor(s, expr, ms = 8000) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await ev(s, expr); if (last) return last; } catch (e) { last = e.message; } await sleep(150); } return false; }
const targets = async () => (await send('Target.getTargets')).targetInfos;

const POPUP = `chrome-extension://${ID}/popup.html`;
const adapters = fs.readFileSync(`${ROOT}/src/adapters.js`, 'utf8');
const stubFor = (fixture, src) => {
  const html = fs.readFileSync(`${ROOT}/tests/fixtures/${fixture}.html`, 'utf8');
  return `${adapters};
    chrome.tabs.query = async () => [{ id: 7, url: ${JSON.stringify(src)} }];
    chrome.scripting.executeScript = async ({ files }) => files ? [] : [{ result: globalThis.CarSageAdapters.detect(new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html'), ${JSON.stringify(src)}) }];`;
};
const sources = JSON.parse(fs.readFileSync(`${ROOT}/tests/fixtures/sources.json`, 'utf8'));
const clearStorage = (s) => ev(s, 'chrome.storage.local.clear().then(() => true)');

try {
  await connect();
  const { liveRequest, liveSummary } = await import(path.join(ROOT, 'src/core.js'));
  // Real public variant pages, opened in a real browser: the extension's own detector reads them, then the API compares across providers.
  const PAGES = [
    ['CarDekho Creta E (new, variant page)', 'https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta_E.htm', 'Delhi'],
    ['CarWale Creta E (new, trim page)', 'https://www.carwale.com/hyundai-cars/creta/e/', 'Delhi'],
  ];
  for (const [label, url, city] of PAGES) {
    const p = await open(url);
    await sleep(5000);
    const v = JSON.parse(await ev(p, `(() => { ${adapters}; const r = globalThis.CarSageAdapters.detect(document, location.href); return JSON.stringify(r.vehicles[0] || null); })()`));
    check(`[${label}] the detector reads the real page`, !!v && v.status === 'new', v && `${v.title} | ${v.priceInr} ${v.priceType} city=${v.priceCity} fuel=${v.fuelType} gear=${v.transmission} cc=${v.displacementCc}`);
    if (!v) continue;
    v.make ||= 'Hyundai'; v.model ||= 'Creta'; v.variant ||= v.title.replace(/^Hyundai Creta\s*/, '') || null;      // what the popup derives from the catalogue lists
    const ask = async (opts) => {
      const req = liveRequest(v, null, { city, ...opts });
      const res = await fetch('http://127.0.0.1:8000/api/prices/compare-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
      const d = await res.json();
      return { req, res, d, sum: liveSummary(d) };
    };
    const needsChoice = v.fuelOptions.length > 1 && !v.fuelType;                      // a trim page that lists petrol and diesel versions
    if (needsChoice) {
      const first = await ask({});
      check(`[${label}] without a fuel the page's versions stay ambiguous and nothing is compared`, first.sum.groups.length === 0 && first.sum.ambiguous > 0, `fuel options ${v.fuelOptions.join('/')}; ambiguous=${first.sum.ambiguous}`);
    }
    const { req, res, d, sum } = await ask(needsChoice ? { fuel: v.fuelOptions[0], gear: v.transmission || 'Manual' } : {});     // the user picks the first listed fuel
    console.log('       request vehicle:', JSON.stringify(req.vehicle));
    console.log('       groups:', JSON.stringify(sum.groups.map((g) => [g.label, g.providers, g.rows.map((r) => `${r.provider} ${r.vehicle} ${r.price} ${r.match}`)])));
    console.log('       claim:', sum.claim, '| incompatible:', sum.incompatible, '| probable:', sum.probable.length, '| failures:', JSON.stringify(sum.failures));
    check(`[${label}] API answers with grouped, source-linked quotes`, res.status === 200 && Array.isArray(d.comparable_groups) && d.quotes.every((q) => q.source_url.startsWith('https://www.')));
    check(`[${label}] the same variant is found at both providers on one basis`, sum.groups.some((g) => g.multi && g.providers.length === 2), sum.claim || sum.failures.join('; '));
    check(`[${label}] no cross-basis mixing`, d.comparable_groups.every((g) => new Set(g.quotes.map((q) => q.basis.code)).size === 1 && new Set(g.quotes.map((q) => q.price_type)).size === 1));
    await send('Target.closeTarget', { targetId: p.targetId });
  }
} catch (e) {
  console.log('DRIVER ERROR', e.stack);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  try { await send('Browser.close'); } catch { /* already closing */ }
  chrome.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chrome may still hold the profile; it is a temp dir */ }
  process.exit(failed ? 1 : 0);
}
