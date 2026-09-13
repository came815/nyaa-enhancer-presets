// These tests load a disposable, localhost-only copy of the real Chrome extension.
// They never contact nyaa.si or any non-local endpoint.
import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureHtml } from "../fixtures/nyaa-fixture.mjs";

const root = resolve(process.cwd());
const TEST_PORT = 4174;
const origin = `http://127.0.0.1:${TEST_PORT}`;
const chromeRoot = join(root, "src", "chrome");
const siteAssetsRoot = join(root, "tests", "fixtures", "site-assets");
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
});
let server;
let requestPages = [];
let requestLog = [];
let failureCounts = new Map();

function safeFixturePath(pathname, prefix, directory) {
  if (!pathname.startsWith(prefix)) return null;
  try {
    const candidate = resolve(directory, decodeURIComponent(pathname.slice(prefix.length)));
    const relation = relative(directory, candidate);
    return relation && !relation.startsWith("..") && !isAbsolute(relation) ? candidate : null;
  } catch { return null; }
}

async function serveStatic(response, path) {
  try {
    response.writeHead(200, { "content-type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
}

function fixtureServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", origin);
    if (url.pathname.startsWith("/src/chrome/")) {
      const path = safeFixturePath(url.pathname, "/src/chrome/", chromeRoot);
      if (!path) { response.writeHead(403).end(); return; }
      await serveStatic(response, path);
      return;
    }
    if (url.pathname.startsWith("/tests/fixtures/site-assets/")) {
      const path = safeFixturePath(url.pathname, "/tests/fixtures/site-assets/", siteAssetsRoot);
      if (!path) { response.writeHead(403).end(); return; }
      await serveStatic(response, path);
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/index.html") { response.writeHead(404).end(); return; }
    const page = Number(url.searchParams.get("p")) || 1;
    if (page > 1) { requestPages.push(page); requestLog.push({ page, at: Date.now() }); }
    const failure = url.searchParams.get("failure");
    const failureKey = `${failure}:${page}`;
    const attempt = failureCounts.get(failureKey) || 0;
    failureCounts.set(failureKey, attempt + 1);
    if (page === 2 && failure === "429once" && attempt === 0) {
      response.writeHead(429, { "Retry-After": "1" }).end("Synthetic rate limit"); return;
    }
    if (page === 2 && failure === "429date" && attempt === 0) {
      response.writeHead(429, { "Retry-After": new Date(Date.now() + 1_100).toUTCString() }).end("Synthetic rate limit"); return;
    }
    if (page === 2 && failure === "malformed") {
      response.writeHead(200, { "content-type": "text/html" }).end("<p>Synthetic malformed response</p>"); return;
    }
    if (page === 2 && url.searchParams.get("slow") === "timeout") {
      await new Promise((resolveClose) => response.once("close", resolveClose));
      return;
    }
    if (page === 2 && url.searchParams.get("slow") === "auto") await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    if (page === 2 && url.searchParams.get("slow") === "1") await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
    const fixtureUrl = new URL(url);
    if (fixtureUrl.searchParams.get("fixture") === "auto-skip" && page > 1) {
      fixtureUrl.searchParams.set("fixture", "skip");
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml(fixtureUrl.href, { preview: false }));
  });
}

async function localhostExtension(testInfo) {
  const extensionDir = join(tmpdir(), `nyaa-enhancer-qa-${testInfo.workerIndex}-${Date.now()}`);
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
  return extensionDir;
}

async function setExtensionPreferences(context, values) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate((preferences) => new Promise((resolve, reject) => {
    chrome.storage.sync.set(preferences, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  }), values);
}

async function openExtensionPage(testInfo, path = "/?s=seeders&o=desc", { autoLoadMore, viewport = { width: 1280, height: 800 } } = {}) {
  const extensionDir = await localhostExtension(testInfo);
  const profile = join(tmpdir(), `nyaa-enhancer-profile-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  if (autoLoadMore !== undefined) await setExtensionPreferences(context, { autoLoadMore });
  const page = await context.newPage();
  await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#ne-date-presets")).toBeVisible();
  await expect(page.locator(".ne-show-more")).toBeVisible();
  const changelog = page.locator(".changelog-container");
  await expect(changelog).toBeVisible();
  await changelog.getByRole("button", { name: "Don't show again" }).click();
  await expect(changelog).toHaveCount(0);
  await page.locator(".magnet-notification-container").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  return { context, page, cleanup: async () => { await context.close(); await rm(extensionDir, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); } };
}

function visibleFixtureRows(page) {
  return page.locator('table.torrent-list tbody tr[data-fixture-row]').evaluateAll((rows) => rows.filter((row) => getComputedStyle(row).display !== "none").map((row) => row.dataset.fixtureRow));
}

function boxesOverlap(first, second) {
  return first && second && first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function autoLoadToggle(page) {
  return page.locator("#ne-date-presets .ne-auto-load__toggle");
}

function autoLoadStatus(page) {
  return page.locator("#ne-date-presets .ne-auto-load__status");
}

async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

test.beforeAll(async () => { server = fixtureServer(); await new Promise((resolveListen) => server.listen(TEST_PORT, "127.0.0.1", resolveListen)); });
test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("real extension applies date presets, preserves native navigation, and quick search preserves scope", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?q=synthetic&c=1_2&dateFilter=month", { autoLoadMore: false });
  try {
    await expect(page).toHaveURL(/s=seeders.*o=desc/);
    await expect(page.locator('#ne-date-presets button[data-preset="month"]')).toHaveAttribute("aria-pressed", "true");
    expect(await visibleFixtureRows(page)).toEqual(["month", "recent", "week"]);
    const visibleSeeders = await page.locator('table.torrent-list tbody tr[data-fixture-row]').evaluateAll((rows) => rows.filter((row) => getComputedStyle(row).display !== "none").map((row) => Number(row.querySelector('td:nth-of-type(6)')?.textContent)));
    expect(visibleSeeders).toEqual([...visibleSeeders].sort((a, b) => b - a));
    for (const [preset, expected] of [["day", ["recent"]], ["week", ["recent", "week"]], ["month", ["month", "recent", "week"]], ["3month", ["month", "recent", "week", "old"]], ["year", ["month", "recent", "week", "old"]]]) {
      await page.locator(`#ne-date-presets button[data-preset="${preset}"]`).click();
      await expect(page).toHaveURL(new RegExp(`dateFilter=${preset}`));
      await expect(page.locator(`#ne-date-presets button[data-preset="${preset}"]`)).toHaveAttribute("aria-pressed", "true");
      expect(await visibleFixtureRows(page)).toEqual(expected);
    }
    const sortHref = await page.locator("#sort-link").getAttribute("href");
    expect(sortHref).toContain("s=id"); expect(sortHref).toContain("o=asc"); expect(sortHref).toContain("dateFilter=year");
    expect(await page.locator('form input[name="dateFilter"]').inputValue()).toBe("year");
    expect(await page.locator('form input[name="s"]').inputValue()).toBe("seeders");
    await expect(page.locator('ul.pagination a[rel="next"]')).toHaveAttribute("href", /dateFilter=year/);
    await Promise.all([
      page.waitForURL(/q=native(?:%20|\+)query/),
      page.locator('form input[name="q"]').fill("native query").then(() => page.getByRole("button", { name: "Native search" }).click()),
    ]);
    await expect(page).toHaveURL(/c=1_2/); await expect(page).toHaveURL(/dateFilter=year/); await expect(page).toHaveURL(/s=seeders/); await expect(page).toHaveURL(/o=desc/);
    await page.locator(".quick-filter-button").click();
    await page.locator("#qs-date-preset").selectOption("week");
    await page.locator("#apply-filter").click();
    await expect(page).toHaveURL(/q=native(?:%20|\+)query/); await expect(page).toHaveURL(/c=1_2/); await expect(page).toHaveURL(/dateFilter=week/); await expect(page).toHaveURL(/s=seeders/); await expect(page).toHaveURL(/o=desc/);
    await Promise.all([page.waitForURL(/s=id.*o=asc/), page.locator("#sort-link").click()]);
    await expect(page).toHaveURL(/dateFilter=week/);
  } finally { await cleanup(); }
});

test("show more skips hidden old pages, waits between requests, deduplicates, and completes on an empty final page", async ({}, testInfo) => {
  requestPages = []; requestLog = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=skip", { autoLoadMore: false });
  try {
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.locator(".ne-show-more__button")).toHaveText("No more results", { timeout: 8_000 });
    expect(requestPages).toEqual([2, 3]);
    expect(requestLog[1].at - requestLog[0].at).toBeGreaterThanOrEqual(1_400);
    await expect(page.locator('[data-fixture-row="page-three"]')).toBeVisible();
    await expect(page.locator('[data-fixture-row="duplicate"]')).toHaveCount(0);
    await expect(page.locator(".ne-show-more__button")).toHaveText("No more results");
    await expect(page.locator(".ne-show-more__status")).toHaveText("3 loaded pages · 4 visible results · Available pages exhausted.");
  } finally { await cleanup(); }

  const empty = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=empty", { autoLoadMore: false });
  try {
    await empty.page.getByRole("button", { name: "Show more results" }).click();
    await expect(empty.page.locator(".ne-show-more__button")).toHaveText("No more results");
    await expect(empty.page.locator('[data-fixture-row="too-old"]')).toBeHidden();
  } finally { await empty.cleanup(); }
});

test("show more cancel and failures retain the same next page without false completion", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&slow=1", { autoLoadMore: false });
  try {
    requestPages = [];
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".ne-show-more__button")).toHaveText("Show more");
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.locator('[data-fixture-row="page-two"]')).toBeVisible();
    expect(requestPages.filter((entry) => entry === 2).length).toBeGreaterThanOrEqual(2);
  } finally { await cleanup(); }

  for (const failure of ["429once", "429date"]) {
    requestPages = []; failureCounts = new Map();
    const loaded = await openExtensionPage(testInfo, `/?s=seeders&o=desc&failure=${failure}`, { autoLoadMore: false });
    try {
      await loaded.page.getByRole("button", { name: "Show more results" }).click();
      await expect(loaded.page.locator(".ne-show-more__status")).toContainText("Rate limited");
      await expect(loaded.page.locator(".ne-show-more__button")).toHaveText("Retry");
      await expect(loaded.page.locator(".ne-show-more__button")).toBeEnabled({ timeout: 4_000 });
      await loaded.page.getByRole("button", { name: "Show more results" }).click();
      await expect(loaded.page.locator('[data-fixture-row="page-two"]')).toBeVisible();
      expect(requestPages.filter((entry) => entry === 2)).toHaveLength(2);
    } finally { await loaded.cleanup(); }
  }

  const malformed = await openExtensionPage(testInfo, "/?s=seeders&o=desc&failure=malformed", { autoLoadMore: false });
  try {
    await malformed.page.getByRole("button", { name: "Show more results" }).click();
    await expect(malformed.page.locator(".magnet-notification").filter({ hasText: "unexpected page" })).toBeVisible();
    await expect(malformed.page.locator(".ne-show-more__button")).toHaveText("Show more");
    await expect(malformed.page.locator('[data-fixture-row="page-two"]')).toHaveCount(0);
  } finally { await malformed.cleanup(); }
});

test("show more stops after ten unique all-old pages and can continue", async ({}, testInfo) => {
  requestPages = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=limit", { autoLoadMore: false });
  try {
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.locator(".ne-show-more__button")).toHaveText("Continue loading", { timeout: 18_000 });
    expect(requestPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    await expect(page.locator("tr.ne-show-more-page")).toHaveCount(10);
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.locator(".ne-show-more__button")).toHaveText("No more results", { timeout: 6_000 });
    expect(requestPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    await expect(page.locator("tr.ne-show-more-page")).toHaveCount(12);
  } finally { await cleanup(); }
});

test("auto loading defaults on but stays idle while a long result page is far from its bottom", async ({}, testInfo) => {
  requestPages = [];
  // No preference is written: this proves the production default rather than an injected test value.
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&fixture=visual", { viewport: { width: 1280, height: 400 } });
  try {
    await expect(autoLoadToggle(page)).toHaveText("Pause auto");
    await expect(autoLoadToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(autoLoadStatus(page)).toBeVisible();
    await page.waitForTimeout(900);
    expect(requestPages).toEqual([]);
  } finally { await cleanup(); }
});

test("auto loading scrolls sequentially, filters imported rows, deduplicates, and honors spacing", async ({}, testInfo) => {
  requestPages = []; requestLog = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=auto-skip", { autoLoadMore: true });
  try {
    await scrollToBottom(page);
    await expect(page.locator('[data-fixture-row="page-three"]')).toBeVisible({ timeout: 8_000 });
    expect(requestPages).toEqual([2, 3]);
    expect(requestLog[1].at - requestLog[0].at).toBeGreaterThanOrEqual(1_400);
    await expect(page.locator('[data-fixture-row="duplicate"]')).toHaveCount(0);
    await expect(page.locator('[data-fixture-row="too-old"]')).toBeHidden();
  } finally { await cleanup(); }
});

test("auto loading starts from an actual bottom scroll on a long page", async ({}, testInfo) => {
  requestPages = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&fixture=visual", { autoLoadMore: true });
  try {
    await page.waitForTimeout(600);
    expect(requestPages).toEqual([]);
    await scrollToBottom(page);
    await expect(page.locator('[data-fixture-row="page-two"]')).toBeVisible({ timeout: 5_000 });
    expect(requestPages).toEqual([2]);
  } finally { await cleanup(); }
});

test("auto loading pauses during a request, persists, and resumes the unchanged next page", async ({}, testInfo) => {
  requestPages = [];
  const { context, page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&slow=auto", { autoLoadMore: true });
  try {
    await expect.poll(() => requestPages.length, { timeout: 5_000 }).toBe(1);
    await expect(page.locator(".ne-show-more__cancel")).toBeVisible();
    await autoLoadToggle(page).click();
    await expect(autoLoadToggle(page)).toHaveText("Resume auto");
    await expect(autoLoadToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-fixture-row="page-two"]')).toHaveCount(0);
    expect(requestPages).toEqual([2]);
    await expect(page.locator(".ne-show-more__cancel")).toBeHidden();

    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await expect.poll(() => worker.evaluate(() => new Promise((resolve) => chrome.storage.sync.get("autoLoadMore", resolve))).then((prefs) => prefs.autoLoadMore)).toBe(false);
    await autoLoadToggle(page).click();
    await expect(page.locator('[data-fixture-row="page-two"]')).toBeVisible({ timeout: 7_000 });
    expect(requestPages).toEqual([2, 2]);
  } finally { await cleanup(); }
});

test("auto loading pauses after its real fetch timeout without advancing the page", async ({}, testInfo) => {
  requestPages = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&slow=timeout", { autoLoadMore: true });
  try {
    await expect.poll(() => requestPages.length, { timeout: 5_000 }).toBe(1);
    await expect(page.locator(".ne-show-more__cancel")).toBeVisible();
    await expect(autoLoadToggle(page)).toHaveText("Resume auto", { timeout: 25_000 });
    await expect(page.locator(".magnet-notification").filter({ hasText: "timed out" })).toBeVisible();
    expect(requestPages).toEqual([2]);
    await expect(page.locator('[data-fixture-row="page-two"]')).toHaveCount(0);
    await page.waitForTimeout(1_700);
    expect(requestPages).toEqual([2]);
  } finally { await cleanup(); }
});

test("auto loading stops after a rate limit and only resumes after the user asks", async ({}, testInfo) => {
  requestPages = []; failureCounts = new Map();
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&failure=429once", { autoLoadMore: true });
  try {
    await expect(autoLoadToggle(page)).toHaveText("Resume auto", { timeout: 5_000 });
    await expect(autoLoadStatus(page)).toContainText("rate limit");
    await page.waitForTimeout(1_500);
    expect(requestPages).toEqual([2]);
    await autoLoadToggle(page).click();
    await expect(page.locator('[data-fixture-row="page-two"]')).toBeVisible({ timeout: 5_000 });
    expect(requestPages).toEqual([2, 2]);
  } finally { await cleanup(); }
});

test("auto loading stops after ten empty pages until the user resumes", async ({}, testInfo) => {
  requestPages = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=limit", { autoLoadMore: true });
  try {
    await expect(autoLoadToggle(page)).toHaveText("Resume auto", { timeout: 20_000 });
    expect(requestPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    await page.waitForTimeout(1_700);
    expect(requestPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    await autoLoadToggle(page).click();
    await expect.poll(() => requestPages.length, { timeout: 6_000 }).toBe(12);
    expect(requestPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  } finally { await cleanup(); }
});

test("simulated visibility signal gates initial loading and the next request inside a skip batch", async ({}, testInfo) => {
  requestPages = [];
  const { context, page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&fixture=skip", { autoLoadMore: false });
  try {
    // Automation keeps real tabs visible. Inject only the visibility signal into
    // the extension's isolated world; this is not proof of OS tab visibility.
    const worker = context.serviceWorkers()[0];
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const session = await context.newCDPSession(page);
    const worlds = [];
    session.on("Runtime.executionContextCreated", ({ context: world }) => worlds.push(world));
    await session.send("Runtime.enable");
    const world = worlds.find((entry) => entry.origin === extensionOrigin && entry.auxData?.isDefault === false);
    expect(world, "the real extension isolated world must be present").toBeTruthy();
    const setHidden = async (hidden) => {
      const result = await session.send("Runtime.evaluate", {
        contextId: world.id,
        expression: `Object.defineProperty(document, 'hidden', {configurable:true, value:${hidden}}); document.dispatchEvent(new Event('visibilitychange')); document.hidden;`,
        returnByValue: true,
      });
      expect(result.exceptionDetails).toBeUndefined();
      expect(result.result.value).toBe(hidden);
    };
    await setHidden(true);
    await autoLoadToggle(page).click();
    await page.waitForTimeout(1_700);
    expect(requestPages).toEqual([]);
    await setHidden(false);
    await expect.poll(() => requestPages).toEqual([2]);
    await setHidden(true);
    await page.waitForTimeout(1_700);
    expect(requestPages).toEqual([2]);
    await expect(autoLoadStatus(page)).toContainText("Waiting for this tab");
    await setHidden(false);
    await expect(page.locator('[data-fixture-row="page-three"]')).toBeVisible();
    expect(requestPages).toEqual([2, 3]);
    await session.detach();
  } finally { await cleanup(); }
});

test("minimum-seeder and file-size filters use canonical Nyaa columns together", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month", { autoLoadMore: false });
  try {
    await page.locator(".ne-filters-panel__header").click();
    await page.locator('[data-ne-toggle="minSeedersFilter"]').click();
    await page.locator("#ne-minSeedersValue").fill("20");
    await page.locator("#ne-minSeedersValue").press("Tab");
    await expect(page.locator('[data-fixture-row="week"]')).toBeHidden();
    await expect(page.locator('[data-fixture-row="recent"]')).toBeVisible();
    await page.locator('[data-ne-toggle="fileSizeFilter"]').click();
    await page.locator("#ne-fileSizeMinInput").fill("900");
    await page.locator("#ne-fileSizeMinInput").press("Tab");
    await expect(page.locator('[data-fixture-row="month"]')).toBeHidden();
    await expect(page.locator('[data-fixture-row="recent"]')).toBeVisible();
  } finally { await cleanup(); }
});

test("new controls stay sticky without overlap in light and dark desktop/mobile views", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&fixture=visual", { autoLoadMore: false });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:.001ms!important;animation-delay:0ms!important;transition-duration:.001ms!important;transition-delay:0ms!important;scroll-behavior:auto!important}" });
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const dark of [false, true]) {
        const currentDark = await page.locator("body").evaluate((body) => body.classList.contains("dark"));
        if (currentDark !== dark) await page.locator("#theme-toggle").click();
        await expect(page.locator("body")).toHaveClass(dark ? /dark/ : /^(?!.*dark).*$/);
        await expect(autoLoadToggle(page)).toBeVisible();
        await expect(autoLoadStatus(page)).toBeVisible();
        await scrollToBottom(page);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await expect(page.locator("#ne-date-presets")).toBeInViewport();
        await expect(autoLoadToggle(page)).toBeInViewport();
        const stickyBox = await page.locator("#ne-date-presets").boundingBox();
        expect(stickyBox?.y).toBeGreaterThanOrEqual(0);
        expect(stickyBox?.y).toBeLessThanOrEqual(2);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator("#ne-date-presets")).toBeInViewport();
        await expect(page.locator(".changelog-container")).toHaveCount(0);
        await expect(page.locator(".magnet-notification.show")).toHaveCount(0);
        const toolbar = await page.locator(".nyaa-enhancer-toolbar").boundingBox();
        const presets = await page.locator("#ne-date-presets").boundingBox();
        const table = await page.locator(".table-responsive").boundingBox();
        expect(boxesOverlap(toolbar, presets)).toBe(false);
        expect(boxesOverlap(presets, table)).toBe(false);
        for (const selector of ["#ne-date-presets", ".nyaa-enhancer-toolbar", ".ne-show-more"]) {
          const overflows = await page.locator(selector).evaluate((element) => element.scrollWidth > element.clientWidth);
          expect(overflows, `${selector} must not overflow at ${width}px`).toBe(false);
        }
        await page.screenshot({ path: testInfo.outputPath(`synthetic-${width}-${dark ? "dark" : "light"}.png`), fullPage: false });
      }
    }
  } finally { await cleanup(); }
});
