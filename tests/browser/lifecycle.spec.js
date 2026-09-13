// These lifecycle checks run the packed extension against local synthetic data only.
import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureHtml } from "../fixtures/nyaa-fixture.mjs";

const root = resolve(process.cwd());
const TEST_PORT = 4176;
const origin = `http://127.0.0.1:${TEST_PORT}`;
const chromeRoot = join(root, "src", "chrome");
const siteAssetsRoot = join(root, "tests", "fixtures", "site-assets");
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
});
let server;

function safeFixturePath(pathname, prefix, directory) {
  if (!pathname.startsWith(prefix)) return null;
  try {
    const candidate = resolve(directory, decodeURIComponent(pathname.slice(prefix.length)));
    const relation = relative(directory, candidate);
    return relation && !relation.startsWith("..") && !isAbsolute(relation) ? candidate : null;
  } catch {
    return null;
  }
}

async function serveStatic(response, path) {
  try {
    response.writeHead(200, {
      "content-type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
}

function fixtureServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", origin);
    if (url.pathname.startsWith("/src/chrome/")) {
      const path = safeFixturePath(url.pathname, "/src/chrome/", chromeRoot);
      if (!path) {
        response.writeHead(403).end();
        return;
      }
      await serveStatic(response, path);
      return;
    }
    if (url.pathname.startsWith("/tests/fixtures/site-assets/")) {
      const path = safeFixturePath(url.pathname, "/tests/fixtures/site-assets/", siteAssetsRoot);
      if (!path) {
        response.writeHead(403).end();
        return;
      }
      await serveStatic(response, path);
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml(url.href, { preview: false }));
  });
}

async function localhostExtension(testInfo) {
  const extensionDir = join(tmpdir(), `nyaa-enhancer-lifecycle-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(extensionDir, { recursive: true });
  await cp(chromeRoot, extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const localMatch = `${origin}/*`;
  manifest.host_permissions = [localMatch];
  manifest.optional_host_permissions = [];
  manifest.content_scripts = manifest.content_scripts.map((script) => ({ ...script, matches: [localMatch] }));
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((resource) => ({ ...resource, matches: [localMatch] }));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionDir;
}

async function openExtensionPage(testInfo) {
  const extensionDir = await localhostExtension(testInfo);
  const profile = join(tmpdir(), `nyaa-enhancer-lifecycle-profile-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(() => new Promise((resolveSet, reject) => {
    chrome.storage.sync.set({ autoLoadMore: false, uiLanguage: "en" }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolveSet();
    });
  }));
  const page = await context.newPage();
  await page.goto(`${origin}/?s=seeders&o=desc`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".nyaa-enhancer-toolbar")).toBeVisible();
  await expect(page.locator(".magnet-select-all")).toBeVisible();
  const changelog = page.locator(".changelog-container");
  await expect(changelog).toBeVisible();
  await changelog.locator(".changelog-button.dont-show").click();
  return {
    context,
    page,
    async cleanup() {
      await context.close();
      await rm(extensionDir, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function sendSetting(context, setting, value) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async ({ setting, value }) => {
    await new Promise((resolveSet, reject) => {
      chrome.storage.sync.set({ [setting]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolveSet();
      });
    });
    const tabs = await chrome.tabs.query({ url: "http://127.0.0.1:4176/*" });
    await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, {
      type: "settingChanged",
      setting,
      value,
    })));
  }, { setting, value });
}

async function appendUnenhancedRow(page, rowName) {
  await page.evaluate((name) => {
    const source = document.querySelector('table.torrent-list tbody tr[data-fixture-row="week"]');
    const row = source.cloneNode(true);
    row.dataset.fixtureRow = name;
    row.querySelector(".magnet-checkbox")?.closest("td")?.remove();
    row.querySelector('a[href^="/view/"]').href = `/view/${name}`;
    document.querySelector("table.torrent-list tbody").appendChild(row);
  }, rowName);
}

test.beforeAll(async () => {
  server = fixtureServer();
  await new Promise((resolveListen) => server.listen(TEST_PORT, "127.0.0.1", resolveListen));
});

test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("first external append is enhanced once and keeps the header selection state", async ({}, testInfo) => {
  const { context, page, cleanup } = await openExtensionPage(testInfo);
  try {
    await appendUnenhancedRow(page, "external-first");
    const newRow = page.locator('[data-fixture-row="external-first"]');
    await expect(newRow.locator(".magnet-checkbox")).toHaveCount(1);
    await expect(newRow.locator(".link-action-copy")).toHaveCount(1);

    await newRow.locator(".magnet-checkbox").check();
    await expect.poll(() => page.locator(".magnet-select-all").evaluate((input) => input.indeterminate)).toBe(true);
    await page.locator(".magnet-select-all").check();
    await expect.poll(() => page.locator(".magnet-select-all").isChecked()).toBe(true);

    await appendUnenhancedRow(page, "external-after-selection");
    await expect(page.locator('[data-fixture-row="external-after-selection"] .magnet-checkbox')).toHaveCount(1);
    await expect.poll(() => page.locator(".magnet-select-all").evaluate((input) => input.indeterminate)).toBe(true);

    await sendSetting(context, "minSeedersFilterEnabled", true);
    await sendSetting(context, "minSeedersFilterValue", 15);
    const weekRow = page.locator('[data-fixture-row="week"]');
    await expect(weekRow).toBeHidden();
    await weekRow.locator("td:nth-of-type(6)").evaluate((cell) => { cell.textContent = "25"; });
    await expect(weekRow).toBeVisible();
    await weekRow.evaluate((row) => row.classList.add("ne-kw-highlight"));
    await weekRow.locator("td:nth-of-type(6)").evaluate((cell) => { cell.textContent = "10"; });
    await expect(weekRow).toBeHidden();
    await weekRow.locator("td:nth-of-type(6)").evaluate((cell) => { cell.textContent = "25"; });
    await expect(weekRow).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("tbody replacement and showButtons toggles rebuild controls without duplicated state", async ({}, testInfo) => {
  const { context, page, cleanup } = await openExtensionPage(testInfo);
  try {
    await page.evaluate(() => {
      const oldBody = document.querySelector("table.torrent-list tbody");
      const replacement = oldBody.cloneNode(true);
      replacement.querySelectorAll(".magnet-checkbox").forEach((checkbox) => checkbox.closest("td")?.remove());
      oldBody.replaceWith(replacement);
    });
    await expect(page.locator('table.torrent-list tbody tr[data-fixture-row="week"] .magnet-checkbox')).toHaveCount(1);

    await sendSetting(context, "showButtons", false);
    await expect(page.locator(".nyaa-enhancer-toolbar")).toHaveCount(0);
    await expect(page.locator(".magnet-select-all")).toHaveCount(0);
    await expect(page.locator(".magnet-checkbox")).toHaveCount(0);

    await sendSetting(context, "showButtons", true);
    await expect(page.locator(".nyaa-enhancer-toolbar")).toHaveCount(1);
    await expect(page.locator(".magnet-select-all")).toHaveCount(1);
    await expect(page.locator('table.torrent-list tbody tr[data-fixture-row="week"] .magnet-checkbox')).toHaveCount(1);

    await page.locator('tr[data-fixture-row="week"] .magnet-checkbox').check();
    await expect(page.locator(".magnet-selection-counter")).toContainText("1 selected");
    await page.locator(".changelog-container, .magnet-notification-container").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator(".nyaa-enhancer-toolbar")).toBeVisible();
      await expect(page.locator(".magnet-selection-counter")).toContainText("1 selected");
      expect(await page.locator(".nyaa-enhancer-toolbar").evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth)).toBe(true);
      await page.screenshot({ path: join(root, ".qa", "rebuild", `lifecycle-selection-${width}.png`), fullPage: false });
    }
  } finally {
    await cleanup();
  }
});
