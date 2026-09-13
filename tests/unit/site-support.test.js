import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { buildPresetUrl, preserveDateNavigation } from "../../src/chrome/shared/date-presets.js";
import { isNyaaSite, resolveNyaaSettingsTarget } from "../../src/chrome/shared/domains.js";

const chromeRoot = new URL("../../src/chrome/", import.meta.url);
const origins = ["https://nyaa.si", "https://sukebei.nyaa.si"];

test("both sites have host access, script/style injection, and dynamic module resource grants", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", chromeRoot), "utf8"));
  for (const origin of origins) {
    const match = `*://${new URL(origin).hostname}/*`;
    assert.ok(manifest.host_permissions.includes(match), `${origin}: host permission`);
    for (const script of manifest.content_scripts) {
      assert.ok(script.matches.includes(match), `${origin}: content script enabled`);
      for (const file of [...(script.js || []), ...(script.css || [])]) {
        await access(new URL(file, chromeRoot));
      }
    }
    const resources = manifest.web_accessible_resources.filter((entry) => entry.matches.includes(match)).flatMap((entry) => entry.resources);
    for (const modulePattern of ["content/*", "content/*/*", "content/*/*/*", "shared/*"]) {
      assert.ok(resources.includes(modulePattern), `${origin}: ${modulePattern} import grant`);
    }
    assert.ok(manifest.content_scripts.some((script) => script.js?.includes("content/loader.js")));
    assert.ok(manifest.content_scripts.some((script) => script.css?.includes("content/styles/date-presets.css")));
  }
});

test("presets and pagination retain each site's origin, category and fixed time", () => {
  const now = 1_700_000_000;
  for (const origin of origins) {
    const preset = buildPresetUrl(`${origin}/?q=synthetic&c=1_3&p=4`, "week", now);
    assert.equal(preset.origin, origin);
    assert.equal(preset.searchParams.get("q"), "synthetic");
    assert.equal(preset.searchParams.get("c"), "1_3");
    assert.equal(preset.searchParams.get("s"), "seeders");
    assert.equal(preset.searchParams.get("o"), "desc");
    const next = preserveDateNavigation("/?q=synthetic&c=1_3&p=2", preset.href);
    assert.equal(next.origin, origin);
    assert.equal(next.searchParams.get("c"), "1_3");
    assert.equal(next.searchParams.get("p"), "2");
    assert.equal(next.searchParams.get("dateAt"), String(now));
    assert.equal(next.searchParams.get("dateFilter"), "week");
  }
});

test("settings opens on the active supported site rather than another domain", async (t) => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  t.after(() => {
    if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
    else delete globalThis.chrome;
  });
  for (const origin of origins) {
    assert.equal(isNyaaSite(`${origin}/`), true);
    globalThis.chrome = { tabs: { query: async () => [{ id: 42, url: `${origin}/?c=1_3` }] } };
    assert.deepEqual(await resolveNyaaSettingsTarget(), { url: `${origin}/settings`, tabId: 42, sameTab: true });
  }
});
