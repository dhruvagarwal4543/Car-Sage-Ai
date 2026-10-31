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
  const v = await open(POPUP, stubFor('cardekho-variant', sources['cardekho-variant.html']));
  await ev(v, `chrome.storage.local.set({ cfg: { apiBase: 'http://127.0.0.1:8001', siteBase: 'http://localhost:5173' } }).then(() => true)`);
  await send('Page.navigate', { url: POPUP }, v.sessionId); await sleep(900);
  check('exact variant match is accepted without a prompt', !!(await waitFor(v, `document.getElementById('vehicle').textContent.includes('Matched: Hyundai Creta E')`)), (await ev(v, `document.getElementById('vehicle').textContent`)).slice(0, 200));
  await ev(v, `document.querySelector('[data-act=history]').click(); true`);
  await ev(v, `(() => { document.getElementById('hm').value = 'India, Delhi'; document.getElementById('hy').value = '2024'; document.querySelector('[data-act=runHistory][data-years="3"]').click(); return true; })()`);
  await waitFor(v, `!!document.querySelector('#histOut svg')`, 8000);
  const circles = await ev(v, `document.querySelectorAll('#histOut circle').length`);
  const txt = await ev(v, `document.getElementById('histOut').textContent`);
  check('3-year chart draws exactly the 4 returned observations', circles === 4, circles + ' points');
  check('change figures come from the server (+11.3%) and the notice is shown', txt.includes('11.3%') && txt.includes('Historical data currently covers'), txt.slice(0, 200));
  check('chart has an accessible label and per-point titles', await ev(v, `document.querySelector('#histOut svg').getAttribute('role') === 'img' && document.querySelectorAll('#histOut circle title').length === 4`));
  await ev(v, `document.querySelector('[data-act=runHistory][data-years="1"]').click(); true`);
  await waitFor(v, `document.querySelectorAll('#histOut circle').length === 2`, 5000);
  check('1-year filter keeps only observations from the last year', (await ev(v, `document.querySelectorAll('#histOut circle').length`)) === 2);
  await ev(v, `(() => { document.getElementById('hy').value = '2020'; document.querySelector('[data-act=runHistory][data-years="3"]').click(); return true; })()`);
  check('no observations -> clear empty state, no chart', !!(await waitFor(v, `document.getElementById('histOut').textContent.includes('No sourced price observations')`)) && (await ev(v, `!document.querySelector('#histOut svg')`)));
  await ev(v, `(() => { document.getElementById('hy').value = '2024'; document.getElementById('ht').value = 'on_road'; document.querySelector('[data-act=runHistory][data-years="3"]').click(); return true; })()`);
  check('price types are never mixed: on-road query returns no ex-showroom points', !!(await waitFor(v, `document.getElementById('histOut').textContent.includes('No sourced price observations')`)));
  await ev(v, `document.querySelector('[data-act=alts]').click(); true`);
  await ev(v, `document.querySelector('[data-act=runAlts]').click(); true`);
  check('alternatives (other models only)', !!(await waitFor(v, `document.querySelectorAll('#altOut li').length === 1 && document.getElementById('altOut').textContent.includes('Venue')`)), (await ev(v, `document.getElementById('altOut').textContent`)).slice(0, 100));
  const relevant = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
  check('no console errors against a healthy API', relevant.length === 0, relevant.join(' || '));
  await clearStorage(v);
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
