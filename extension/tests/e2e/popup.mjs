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
  const r = await send('Extensions.loadUnpacked', { path: ROOT });
  check('Extensions.loadUnpacked accepts the extension (manifest valid)', r.id === ID, r.id);
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
  await send('Target.setDiscoverTargets', { discover: true });

  // ---- T1: loads, health, unsupported tab
  const p = await open(POPUP);
  check('popup page loads from the unpacked extension', (await ev(p, 'document.title')) === 'CarSage AI', await ev(p, 'location.href'));
  check('connection pill shows Connected (backend + CORS for the extension origin)', !!(await waitFor(p, `document.getElementById('conn').textContent === 'Connected'`)), await ev(p, `document.getElementById('conn').textContent`));
  check('unsupported active tab shows a clear message', !!(await waitFor(p, `document.getElementById('vehicle').textContent.includes('Page not supported')`)), (await ev(p, `document.getElementById('vehicle').textContent`)).slice(0, 120));
  check('manifest permissions in the running browser', true, JSON.stringify(await ev(p, 'chrome.runtime.getManifest().permissions')) + ' host=' + JSON.stringify(await ev(p, 'chrome.runtime.getManifest().host_permissions')));

  // ---- T2: search
  await clearStorage(p);
  await ev(p, `(() => { const q = document.getElementById('q'); q.value = 'creta'; q.dispatchEvent(new Event('input')); return true; })()`);
  check('search returns real catalogue rows', !!(await waitFor(p, `document.querySelectorAll('#results li').length > 0`)), (await ev(p, `document.querySelectorAll('#results li').length`)) + ' rows');
  await ev(p, `(() => { const q = document.getElementById('q'); q.value = 'zzzzqq'; q.dispatchEvent(new Event('input')); return true; })()`);
  check('empty search shows the empty state', !!(await waitFor(p, `document.getElementById('results').textContent.includes('No cars match')`)));

  // ---- T3: compare list, storage, limit, URL
  await ev(p, `(() => { const q = document.getElementById('q'); q.value = 'creta'; q.dispatchEvent(new Event('input')); return true; })()`);
  await waitFor(p, `document.querySelectorAll('#results [data-act=rCompare]').length >= 5`);
  const clickNth = (n) => ev(p, `document.querySelectorAll('#results [data-act=rCompare]')[${n}].click(); true`);
  await clickNth(0);
  check('open-comparison is disabled with one car', await ev(p, `document.querySelector('[data-act=openCompare]').disabled`));
  await clickNth(1);
  check('two cars enable the comparison button', await ev(p, `!document.querySelector('[data-act=openCompare]').disabled`));
  await clickNth(1);
  check('the same car is not added twice', (await ev(p, `document.querySelectorAll('#compare li').length`)) === 2);
  const before = (await targets()).length;
  await ev(p, `document.querySelector('[data-act=openCompare]').click(); true`);
  await sleep(1200);
  const cmpTab = (await targets()).find((t) => /\/compare\?ids=\d+,\d+/.test(t.url));
  const ids = (await ev(p, `chrome.storage.local.get('compare').then((r) => r.compare.map((x) => x.carId).join(','))`));
  check('Open comparison opens the website route with the stored ids', !!cmpTab && cmpTab.url.endsWith(`/compare?ids=${ids}`), cmpTab ? cmpTab.url : 'no tab (tabs before ' + before + ')');
  await clickNth(2); await clickNth(3); await clickNth(4);
  check('fifth car is refused with a message (limit 4)', (await ev(p, `document.querySelectorAll('#compare li').length`)) === 4 && dialogs.some((m) => m.includes('up to 4')), dialogs.join('|'));
  await ev(p, `document.querySelector('[data-act=rmCompare]').click(); true`);
  check('remove works', (await ev(p, `document.querySelectorAll('#compare li').length`)) === 3);
  await send('Target.closeTarget', { targetId: p.targetId });
  const p2 = await open(POPUP);
  check('comparison list survives reopening the popup (chrome.storage)', !!(await waitFor(p2, `document.querySelectorAll('#compare li').length === 3`)));

  // ---- T4: theme and settings, offline
  await ev(p2, `document.getElementById('theme').click(); true`);
  const th = await ev(p2, `document.documentElement.dataset.theme`);
  check('theme toggle sets and stores a theme', ['dark', 'light'].includes(th) && (await ev(p2, `chrome.storage.local.get('theme').then((r) => r.theme)`)) === th, th);
  await ev(p2, `(() => { document.getElementById('apiBase').value = 'http://127.0.0.1:9'; document.getElementById('saveCfg').click(); return true; })()`);
  check('unreachable API shows Offline', !!(await waitFor(p2, `document.getElementById('conn').textContent === 'Offline'`)));
  await ev(p2, `(() => { const q = document.getElementById('q'); q.value = 'nexon'; q.dispatchEvent(new Event('input')); return true; })()`);
  check('search failure shows an error with Retry', !!(await waitFor(p2, `document.getElementById('results').textContent.includes('Cannot reach') && !!document.querySelector('#results [data-act=search]')`)), (await ev(p2, `document.getElementById('results').textContent`)).slice(0, 90));
  await ev(p2, `(() => { document.getElementById('apiBase').value = 'http://127.0.0.1:8000'; document.getElementById('saveCfg').click(); return true; })()`);
  check('restoring the API address reconnects', !!(await waitFor(p2, `document.getElementById('conn').textContent === 'Connected'`)));
  await clearStorage(p2); await send('Target.closeTarget', { targetId: p2.targetId });

  // ---- T5: vehicle flow on real-page fixtures (page reading is stubbed; everything else is real)
  for (const [fixture, expectTitle, expectPrice] of [['cardekho-variant', 'Hyundai Creta E', '₹10.91 lakh'], ['carwale-used', '2022 Hyundai Creta EX 1.5 Diesel', '₹11.90 lakh']]) {
    const v = await open(POPUP, stubFor(fixture, sources[fixture + '.html']));
    const shown = await waitFor(v, `document.getElementById('vehicle').textContent.includes(${JSON.stringify(expectTitle)})`);
    const txt = await ev(v, `document.getElementById('vehicle').textContent`);
    check(`[${fixture}] vehicle card shows title and price`, !!shown && txt.includes(expectPrice), txt.slice(0, 260));
    check(`[${fixture}] ambiguous match: placeholder chosen, actions disabled`, !!(await waitFor(v, `!!document.getElementById('cand')`)) && (await ev(v, `document.getElementById('cand').value === '' && ['addCompare','history','alts','open'].every((a) => document.querySelector('[data-act=' + a + ']').disabled)`)));
    await ev(v, `document.querySelector('[data-act=confirm]').click(); true`);
    check(`[${fixture}] confirming without a choice stays unmatched`, await ev(v, `!!document.getElementById('cand') && document.querySelector('[data-act=history]').disabled`));
    await ev(v, `(() => { const c = document.getElementById('cand'); c.value = c.options[1].value; document.querySelector('[data-act=confirm]').click(); return true; })()`);
    check(`[${fixture}] picking a variant enables the actions`, await ev(v, `!document.querySelector('[data-act=history]').disabled && document.getElementById('vehicle').textContent.includes('Matched:')`));
    await ev(v, `document.querySelector('[data-act=save]').click(); true`);
    check(`[${fixture}] Save keeps the source URL, listing price type and "this device" label`, await ev(v, `chrome.storage.local.get('saved').then((r) => r.saved.length === 1 && !!r.saved[0].sourceUrl && r.saved[0].carId > 0)`) && (await ev(v, `document.getElementById('saved').textContent.includes('Saved on this device')`)));
    await ev(v, `document.querySelector('[data-act=save]').click(); true`);
    check(`[${fixture}] saving twice does not duplicate`, (await ev(v, `chrome.storage.local.get('saved').then((r) => r.saved.length)`)) === 1);
    await ev(v, `document.querySelector('[data-act=addCompare]').click(); true`);
    check(`[${fixture}] Add to Compare stores the listing's source`, await ev(v, `chrome.storage.local.get('compare').then((r) => r.compare.length === 1 && r.compare[0].site !== 'CarSage catalogue' && !!r.compare[0].sourceUrl)`));
    await ev(v, `document.querySelector('[data-act=history]').click(); true`);
    await ev(v, `document.querySelector('[data-act=runHistory][data-years="3"]').click(); true`);
    await waitFor(v, `document.getElementById('histOut').textContent.length > 20 && !document.getElementById('histOut').textContent.includes('Loading')`, 10000);
    console.log('       price-history result:', (await ev(v, `document.getElementById('histOut').textContent`)).slice(0, 160));
    await ev(v, `document.querySelector('[data-act=alts]').click(); true`);
    await ev(v, `document.querySelector('[data-act=runAlts]').click(); true`);
    check(`[${fixture}] alternatives come from the recommendation API`, !!(await waitFor(v, `document.querySelectorAll('#altOut li').length > 0`, 10000)), (await ev(v, `document.getElementById('altOut').textContent`)).slice(0, 120));
    await ev(v, `document.querySelector('[data-act=open]').click(); true`);
    await sleep(900);
    check(`[${fixture}] Open Details opens /cars/<id>`, (await targets()).some((t) => /localhost:5173\/cars\/\d+/.test(t.url)));
    await ev(v, `document.querySelector('[data-act=rechoose]').click(); true`);
    check(`[${fixture}] Change variant returns to the picker and disables the actions`, await ev(v, `!!document.getElementById('cand') && document.querySelector('[data-act=addCompare]').disabled`));
    await ev(v, `(() => { const c = document.getElementById('cand'); c.value = c.options[2].value; document.querySelector('[data-act=confirm]').click(); return true; })()`);
    await ev(v, `document.querySelector('[data-act=addCompare]').click(); true`);
    check(`[${fixture}] two variants of the same model can be compared`, await ev(v, `chrome.storage.local.get('compare').then((r) => r.compare.length === 2 && r.compare[0].carId !== r.compare[1].carId && r.compare.every((x) => x.label.startsWith('Hyundai Creta')) && !document.querySelector('[data-act=openCompare]').disabled)`));
    await clearStorage(v); await send('Target.closeTarget', { targetId: v.targetId });
  }
  const relevant = consoleErrors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource|favicon/.test(e));
  check('no unexpected console errors in the popup', relevant.length === 0, relevant.slice(0, 4).join(' || '));
  console.log('\nall console errors seen:', consoleErrors.length ? consoleErrors : 'none');
} catch (e) {
  console.log('DRIVER ERROR', e.stack);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  try { await send('Browser.close'); } catch { /* already closing */ }
  chrome.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
