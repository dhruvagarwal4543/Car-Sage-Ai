// Website smoke test in real headless Chrome: every route renders, no console/runtime errors, Advisor shows the decision trace, Compare shows both cars.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'carsage-site-'));   // needs the API on :8000 and the website on :5173 (see extension/README.md)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${PROFILE}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 1, buf = ''; const pending = new Map(); const errors = [];
chrome.stdio[4].on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\0')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else onEvent(m); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); chrome.stdio[3].write(JSON.stringify({ id: i, method, params, sessionId }) + '\0'); });
function onEvent(m) {
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text.slice(0, 200));
}
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const BASE = 'http://localhost:5173';
try {
  await sleep(1500);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await send(m, {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };
  const go = async (route) => { await send('Page.navigate', { url: BASE + route }, sessionId); await sleep(2500); };
  const waitText = async (sel, re, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await ev(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`); if (re.test(t)) return t; await sleep(200); } return null; };

  for (const [route, h1] of [['/', /Find your next/i], ['/cars', /Explore/], ['/cars/1119', /Creta/], ['/compare?ids=1119,1120', /Compare/], ['/advisor', /Advisor/], ['/login', /Sign in/], ['/saved', /Saved/], ['/credits', /credits/i], ['/nope', /not found/i]]) {
    const before = errors.length; await go(route);
    const t = await waitText(route === '/nope' ? '.state strong' : 'h1', h1, 8000);   // the 404 page has no h1
    check(`route ${route} renders`, !!t, (t || '').slice(0, 50));
    check(`route ${route} has no runtime errors`, errors.length === before, errors.slice(before).join(' || '));
  }
  await go('/cars');
  const n = await ev(`document.querySelectorAll('article, .car-card').length`);
  check('explore lists catalogue cards from the live API', n >= 6, n + ' cards');
  await ev(`(() => { const i = document.querySelector('input[type=search], input[placeholder*="Make"]'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'creta'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(2000);
  check('explore search narrows to Creta', /Creta/.test(await ev(`document.body.textContent`)) && (await ev(`[...document.querySelectorAll('h3, h2')].filter((e) => /Creta/.test(e.textContent)).length`)) >= 1);

  await go('/cars/1119');
  await ev(`[...document.querySelectorAll('button')].find((b) => /Check current prices/.test(b.textContent)).click(); true`);
  const live = await waitText('#live-h + p + .actions + [role=status], section[aria-labelledby=live-h]', /(No exact variant quote|Only \w+ returned|Lowest comparable|Model-level|HTTP|rate limit|retry in|Cannot reach)/, 40000);
  check('car detail live-price panel answers (quotes with sources, or an honest reason)', !!live, (live || '').replace(/\s+/g, ' ').slice(0, 160));
  check('car detail keeps the catalogue price labelled separately from live prices', /historical/.test(await ev(`document.querySelector('section[aria-labelledby=live-h]').textContent`)));

  await go('/compare?ids=1119,1120');
  const cells = await ev(`document.body.textContent`);
  check('compare shows both Creta variants and a best-value highlight', /1\.4 Crdi E Plus/.test(cells) && /1\.6 Vtvt E Plus/.test(cells) && (await ev(`document.querySelectorAll('.best, [class*="best"]').length`)) >= 1);

  await go('/advisor');
  await ev(`(() => { const i = document.getElementById('adv-in'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'family suv under 15 lakh diesel for highway driving'); i.dispatchEvent(new Event('input', { bubbles: true })); i.closest('form').requestSubmit(); return true; })()`);
  const reply = await waitText('.chat', /Top picks|could not find/, 15000);
  check('advisor answers from the live agent', !!reply, (reply || '').slice(0, 80));
  check('advisor names the unsupported request instead of guessing', /cannot filter by highway/.test(reply || ''));
  check('advisor shows the decision trace', !!(await ev(`document.querySelector('details.trace summary')?.textContent`)), await ev(`document.querySelector('details.trace summary')?.textContent || ''`));
  await ev(`document.querySelector('details.trace').open = true; true`);
  const traceText = await ev(`document.querySelector('details.trace').textContent`);
  check('trace lists constraints, eliminations and ranking method', /budget up to/.test(traceText) && /rules out \d+ cars/.test(traceText) && /Ranked by/.test(traceText), traceText.slice(0, 160));
  await ev(`(() => { const i = document.getElementById('adv-in'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'diesel under 3 lakh'); i.dispatchEvent(new Event('input', { bubbles: true })); i.closest('form').requestSubmit(); return true; })()`);
  await sleep(4000);
  const traces = await ev(`[...document.querySelectorAll('details.trace summary')].map((e) => e.textContent)`);
  check('relaxation is announced in the trace when nothing fits strictly', traces.length === 2 && /relaxed/.test(traces[1]), traces[1] || '');
  const unexpected = errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED/.test(e));
  check('no unexpected console errors across the session', unexpected.length === 0, unexpected.slice(0, 3).join(' || '));
} catch (e) { console.log('DRIVER ERROR', e.stack); } finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} website checks passed`);
  try { await send('Browser.close'); } catch { /* closing */ }
  chrome.kill(); try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* temp */ } process.exit(0);
}
