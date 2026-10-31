// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const has = (p) => existsSync(new URL('../' + p, import.meta.url));

describe('manifest', () => {
  it('is Manifest V3 with a working popup', () => {
    expect(m.manifest_version).toBe(3); expect(m.name).toBeTruthy(); expect(has(m.action.default_popup)).toBe(true);
  });
  it('asks for the minimum: no host access, no always-on content scripts, no remote code', () => {
    expect([...m.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']);
    for (const k of ['host_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'web_accessible_resources']) expect(m[k]).toBeUndefined();
    expect(m.content_security_policy.extension_pages).not.toMatch(/unsafe|http/);
  });
  it('ships the files the popup and injection need', () => {
    for (const f of ['src/adapters.js', 'src/core.js', 'src/popup.js', 'popup.css']) expect(has(f)).toBe(true);
    expect(readFileSync(new URL('../popup.html', import.meta.url), 'utf8')).not.toMatch(/<script(?![^>]*src=)/);   // no inline script (MV3 CSP)
  });
});
