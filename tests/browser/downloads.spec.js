// Disposable localhost-only regression coverage for cancellable torrent batches.
import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureHtml } from "../fixtures/nyaa-fixture.mjs";

const root = resolve(process.cwd());
const port = 4175;
const origin = `http://127.0.0.1:${port}`;
let server;
let downloads = [];
const chromeRoot = join(root, "src", "chrome");
const siteAssetsRoot = join(root, "tests", "fixtures", "site-assets");
const contentTypes = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };

function safeFixturePath(pathname, prefix, directory) {
  if (!pathname.startsWith(prefix)) return null;
  const candidate = resolve(directory, decodeURIComponent(pathname.slice(prefix.length)));
  const relation = relative(directory, candidate);
  return relation && !relation.startsWith("..") && !isAbsolute(relation) ? candidate : null;
}

async function serveStatic(response, path) {
  try {
    response.writeHead(200, { "content-type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
}

async function createExtension(testInfo) {
  const directory = join(tmpdir(), `nyaa-downloads-${testInfo.workerIndex}-${Date.now()}`);
  await cp(join(root, "src", "chrome"), directory, { recursive: true });
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [`${origin}/*`];
  manifest.optional_host_permissions = [];
  manifest.content_scripts = manifest.content_scripts.map((entry) => ({ ...entry, matches: [`${origin}/*`] }));
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((entry) => ({ ...entry, matches: [`${origin}/*`] }));
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return directory;
}

async function openPage(testInfo, viewport, useZip = false, uiLanguage = "en") {
  const extension = await createExtension(testInfo);
  const profile = join(tmpdir(), `nyaa-downloads-profile-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(({ zip, language }) => new Promise((resolveSet) => chrome.storage.sync.set({ useZip: zip, autoLoadMore: false, uiLanguage: language }, resolveSet)), { zip: useZip, language: uiLanguage });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#ne-date-presets")).toBeVisible();
  await expect(page.locator(".ne-show-more")).toBeVisible();
  await expect(page.locator(".download-button").first()).toBeVisible();
  const changelog = page.locator(".changelog-container");
  await expect(changelog).toBeVisible();
  await changelog.locator(".changelog-button.dont-show").click();
  await page.locator(".magnet-notification-container").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  return { page, cleanup: async () => { await context.close(); await rm(extension, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); } };
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", origin);
    if (url.pathname.startsWith("/src/chrome/")) {
      const path = safeFixturePath(url.pathname, "/src/chrome/", chromeRoot);
      if (!path) response.writeHead(403).end(); else serveStatic(response, path);
      return;
    }
    if (url.pathname.startsWith("/tests/fixtures/site-assets/")) {
      const path = safeFixturePath(url.pathname, "/tests/fixtures/site-assets/", siteAssetsRoot);
      if (!path) response.writeHead(403).end(); else serveStatic(response, path);
      return;
    }
    if (url.pathname.startsWith("/download/")) {
      downloads.push(url.pathname);
      if (downloads.length === 1) {
        response.writeHead(200, { "content-type": "application/x-bittorrent" });
        response.write("partial"); // Headers arrive; the response body remains stalled until cancellation.
        return;
      }
      response.writeHead(200, { "content-type": "application/x-bittorrent" }).end("synthetic");
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/index.html") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(fixtureHtml(url.href, { preview: false }));
  });
  await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
});
test.afterAll(async () => { server.closeAllConnections?.(); await new Promise((resolveClose) => server.close(resolveClose)); });

test("cancelling an in-flight sequential batch stops future fetches and a later batch can start", async ({}, testInfo) => {
  downloads = [];
  const { page, cleanup } = await openPage(testInfo, { width: 1920, height: 1080 });
  try {
    await page.locator(".magnet-checkbox").first().check();
    await page.locator(".magnet-checkbox").nth(1).check();
    await expect(page.locator('td[colspan="2"] a[href^="/view/"]').first()).toBeVisible();
    await page.locator(".download-button").first().click();
    await expect.poll(() => downloads.length).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("download-progress-1920.png") });
    await page.locator(".ne-download-progress__cancel:not(:disabled)").click();
    await expect(page.locator(".ne-download-progress__status")).toContainText("cancelled");
    await page.waitForTimeout(700);
    expect(downloads).toHaveLength(1);
    const emittedDownloads = [];
    page.on("download", (download) => emittedDownloads.push(download));
    await page.locator(".download-button").first().click();
    await expect.poll(() => downloads.length).toBe(3);
    await expect.poll(() => emittedDownloads.length).toBe(2);
    await expect(page.locator(".ne-download-progress__status").last()).toContainText("complete");
  } finally { await cleanup(); }
});

test("cancel control remains usable in a narrow viewport", async ({}, testInfo) => {
  downloads = [];
  const { page, cleanup } = await openPage(testInfo, { width: 390, height: 844 }, false, "ja");
  try {
    await page.locator(".magnet-checkbox").first().check();
    await page.locator(".download-button").first().click();
    const cancel = page.getByRole("button", { name: "ダウンロードを中止" });
    await expect(cancel).toBeVisible();
    const box = await cancel.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("download-progress-ja-390.png") });
    await cancel.click();
  } finally { await cleanup(); }
});

test("cancelling a ZIP batch during a delayed response body saves no ZIP", async ({}, testInfo) => {
  downloads = [];
  const { page, cleanup } = await openPage(testInfo, { width: 1280, height: 800 }, true);
  try {
    await page.locator(".magnet-checkbox").nth(0).check();
    await page.locator(".magnet-checkbox").nth(1).check();
    const emittedDownloads = [];
    page.on("download", (download) => emittedDownloads.push(download));
    await page.locator(".download-button").first().click();
    await expect.poll(() => downloads.length).toBe(1);
    await page.locator(".ne-download-progress__cancel:not(:disabled)").click();
    await expect(page.locator(".ne-download-progress__status")).toContainText("No ZIP file was saved");
    await page.waitForTimeout(700);
    expect(emittedDownloads).toHaveLength(0);
    expect(downloads).toHaveLength(1);
  } finally { await cleanup(); }
});

test("a delayed response body times out and the next queued file still downloads", async ({}, testInfo) => {
  downloads = [];
  const { page, cleanup } = await openPage(testInfo, { width: 1280, height: 800 });
  try {
    await page.locator(".magnet-checkbox").nth(0).check();
    await page.locator(".magnet-checkbox").nth(1).check();
    const emittedDownloads = [];
    page.on("download", (download) => emittedDownloads.push(download));
    await page.locator(".download-button").first().click();
    await expect(page.locator(".magnet-notification").filter({ hasText: "Timed out downloading" })).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => downloads.length, { timeout: 25_000 }).toBe(2);
    await expect.poll(() => emittedDownloads.length, { timeout: 25_000 }).toBe(1);
  } finally { await cleanup(); }
});
