// Settings regression coverage uses an isolated localhost-only extension copy.
// It never opens Nyaa or any external URL.
import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureHtml } from "../fixtures/nyaa-fixture.mjs";

const root = resolve(process.cwd());
const TEST_PORT = 4177;
const origin = `http://127.0.0.1:${TEST_PORT}`;
let server;

async function localhostExtension(testInfo, { failKey = null, includeLocalRelay = false } = {}) {
  const extensionDir = join(tmpdir(), `nyaa-settings-qa-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(extensionDir, { recursive: true });
  await cp(join(root, "src", "chrome"), extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const localMatch = `${origin}/*`;
  manifest.host_permissions = [localMatch];
  manifest.optional_host_permissions = [];
  manifest.content_scripts = manifest.content_scripts.map((script) => ({ ...script, matches: [localMatch] }));
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((resource) => ({ ...resource, matches: [localMatch] }));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (includeLocalRelay) {
    const domainsPath = join(extensionDir, "shared", "domains.js");
    const domains = await readFile(domainsPath, "utf8");
    await writeFile(
      domainsPath,
      domains.replace(
        'export const NYAA_MATCHES = NYAA_DOMAINS.map((domain) => `*://*.${domain}/*`);',
        'export const NYAA_MATCHES = NYAA_DOMAINS.map((domain) => `*://*.${domain}/*`);\nNYAA_MATCHES.push("http://127.0.0.1:4177/*");',
      ),
    );
  }

  if (failKey) {
    const prefsPath = join(extensionDir, "shared", "prefs.js");
    const prefs = await readFile(prefsPath, "utf8");
    await writeFile(
      prefsPath,
      prefs.replace(
        'function areaSet(area, items) {',
        `function areaSet(area, items) {\n  if (area === "sync" && Object.hasOwn(items || {}, ${JSON.stringify(failKey)})) return Promise.reject(new Error("Synthetic storage failure"));`,
      ),
    );
  }
  return extensionDir;
}

async function launchExtension(testInfo, options) {
  const extensionDir = await localhostExtension(testInfo, options);
  const profile = join(tmpdir(), `nyaa-settings-profile-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    extensionId,
    cleanup: async () => {
      await context.close();
      await rm(extensionDir, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function setPreferences(context, values) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate((preferences) => new Promise((resolveSet, rejectSet) => {
    chrome.storage.sync.set(preferences, () => {
      if (chrome.runtime.lastError) rejectSet(new Error(chrome.runtime.lastError.message));
      else resolveSet();
    });
  }), values);
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", origin);
    if (url.pathname !== "/" && url.pathname !== "/settings") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml(url.href, { preview: false }));
  });
  await new Promise((resolveListen) => server.listen(TEST_PORT, "127.0.0.1", resolveListen));
});

test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("popup opens the standalone settings page when no supported site is open", async ({}, testInfo) => {
  const { context, extensionId, cleanup } = await launchExtension(testInfo);
  try {
    const popup = await context.newPage();
    const errors = [];
    popup.on("pageerror", (error) => errors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "domcontentloaded" });
    const settingsLink = popup.locator("#settings .ne-settings-page-link");
    await expect(settingsLink).toHaveAttribute("href", `chrome-extension://${extensionId}/pages/settings/index.html`);
    await settingsLink.click({ noWaitAfter: true, timeout: 5_000 });
    // Directly opening the popup document in Playwright makes window.close()
    // replace it with about:blank. The inspected fallback URL above is the
    // exact URL passed to chrome.tabs.create by the real click handler.
    await expect.poll(() => popup.isClosed() || popup.url() === "about:blank", { timeout: 5_000 }).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("native and standalone settings persist toggles, localize, and fit desktop and narrow viewports", async ({}, testInfo) => {
  const { context, extensionId, cleanup } = await launchExtension(testInfo);
  try {
    await setPreferences(context, { uiLanguage: "ja" });
    const errors = [];
    const native = await context.newPage();
    native.on("pageerror", (error) => errors.push(error.message));
    await native.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
    const nativeToggle = native.locator('[data-setting="showQuickFilter"]');
    await expect(nativeToggle).toBeVisible();
    const initial = await nativeToggle.getAttribute("aria-checked");
    await nativeToggle.click();
    await nativeToggle.click();
    await expect(nativeToggle).toHaveAttribute("aria-checked", initial);
    expect(errors).toEqual([]);

    const settings = await context.newPage();
    settings.on("pageerror", (error) => errors.push(error.message));
    await settings.goto(`chrome-extension://${extensionId}/pages/settings/index.html`, { waitUntil: "domcontentloaded" });
    await expect(settings.locator(".ne-settings-page__header h1")).toHaveText("Nyaa Enhancer 設定");
    await settings.setViewportSize({ width: 1920, height: 1080 });
    await expect(settings.locator("#ne-settings-language")).toHaveValue("ja");
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath("standalone-settings-ja-1920.png"), fullPage: false });

    await settings.setViewportSize({ width: 390, height: 844 });
    const japaneseLanguageBox = await settings.locator("#ne-settings-language").boundingBox();
    expect(japaneseLanguageBox?.x).toBeGreaterThanOrEqual(0);
    expect((japaneseLanguageBox?.x || 0) + (japaneseLanguageBox?.width || 0)).toBeLessThanOrEqual(390);
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath("standalone-settings-ja-390.png"), fullPage: false });

    await settings.locator("#ne-settings-language").selectOption("en");
    await expect(settings.locator("#ne-settings-language")).toHaveValue("en");
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath("standalone-settings-en-390.png"), fullPage: false });
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("standalone toggle rolls back and reports a disposable storage failure", async ({}, testInfo) => {
  const { context, extensionId, cleanup } = await launchExtension(testInfo, { failKey: "showQuickFilter" });
  try {
    const settings = await context.newPage();
    const errors = [];
    settings.on("pageerror", (error) => errors.push(error.message));
    await settings.goto(`chrome-extension://${extensionId}/pages/settings/index.html`, { waitUntil: "domcontentloaded" });
    const toggle = settings.locator('[data-setting="showQuickFilter"]');
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", before);
    await expect(settings.locator("#ne-settings-save-status")).toContainText("設定を保存できませんでした");
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("list filter toggle restores its prior state after a disposable storage failure", async ({}, testInfo) => {
  const { context, cleanup } = await launchExtension(testInfo, { failKey: "minSeedersFilterEnabled" });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.locator(".ne-filters-panel__header").click();
    const toggle = page.locator('[data-ne-toggle="minSeedersFilter"]');
    const input = page.locator("#ne-minSeedersValue");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(input).toBeDisabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(input).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("popup client save failure never reports Saved", async ({}, testInfo) => {
  const { context, extensionId, cleanup } = await launchExtension(testInfo, { failKey: "torrentClient" });
  try {
    const popup = await context.newPage();
    const errors = [];
    popup.on("pageerror", (error) => errors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "domcontentloaded" });
    await popup.locator(".nav-button[data-tab='torrent-client']").click();
    await popup.locator("#tcIp").fill("http://127.0.0.1:8080");
    await popup.locator("#tcSaveBtn").click();
    await expect(popup.locator("#tcStatus")).toContainText("設定を保存できませんでした");
    await expect(popup.locator("#tcStatus")).not.toContainText("保存しました");
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("settings relays a saved toggle to another localhost tab", async ({}, testInfo) => {
  const { context, cleanup } = await launchExtension(testInfo, { includeLocalRelay: true });
  try {
    const errors = [];
    const list = await context.newPage();
    list.on("pageerror", (error) => errors.push(error.message));
    await list.goto(origin, { waitUntil: "domcontentloaded" });
    await expect(list.locator(".nyaa-enhancer-toolbar")).toBeVisible();

    const settings = await context.newPage();
    settings.on("pageerror", (error) => errors.push(error.message));
    await settings.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
    await settings.locator('[data-setting="showButtons"]').click();
    await expect(list.locator(".nyaa-enhancer-toolbar")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});
