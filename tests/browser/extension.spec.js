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
    if (page === 2 && url.searchParams.get("slow") === "1") await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml(url.href, { preview: false }));
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

async function openExtensionPage(testInfo, path = "/?s=seeders&o=desc") {
  const extensionDir = await localhostExtension(testInfo);
  const profile = join(tmpdir(), `nyaa-enhancer-profile-${testInfo.workerIndex}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
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

test.beforeAll(async () => { server = fixtureServer(); await new Promise((resolveListen) => server.listen(TEST_PORT, "127.0.0.1", resolveListen)); });
test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("real extension applies date presets, preserves native navigation, and quick search preserves scope", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?q=synthetic&c=1_2&dateFilter=month");
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
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=skip");
  try {
    await page.getByRole("button", { name: "Show more results" }).click();
    await expect(page.locator(".ne-show-more__button")).toHaveText("No more results", { timeout: 8_000 });
    expect(requestPages).toEqual([2, 3]);
    expect(requestLog[1].at - requestLog[0].at).toBeGreaterThanOrEqual(1_400);
    await expect(page.locator('[data-fixture-row="page-three"]')).toBeVisible();
    await expect(page.locator('[data-fixture-row="duplicate"]')).toHaveCount(0);
    await expect(page.locator(".ne-show-more__button")).toHaveText("No more results");
    await expect(page.locator(".ne-show-more__status")).toHaveText("3 loaded pages · 4 visible results · available pages exhausted");
  } finally { await cleanup(); }

  const empty = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=empty");
  try {
    await empty.page.getByRole("button", { name: "Show more results" }).click();
    await expect(empty.page.locator(".ne-show-more__button")).toHaveText("No more results");
    await expect(empty.page.locator('[data-fixture-row="too-old"]')).toBeHidden();
  } finally { await empty.cleanup(); }
});

test("show more cancel and failures retain the same next page without false completion", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&slow=1");
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
    const loaded = await openExtensionPage(testInfo, `/?s=seeders&o=desc&failure=${failure}`);
    try {
      await loaded.page.getByRole("button", { name: "Show more results" }).click();
      await expect(loaded.page.locator(".ne-show-more__status")).toContainText("Rate limited");
      await expect(loaded.page.locator(".ne-show-more__button")).toHaveText("Show more", { timeout: 4_000 });
      await loaded.page.getByRole("button", { name: "Show more results" }).click();
      await expect(loaded.page.locator('[data-fixture-row="page-two"]')).toBeVisible();
      expect(requestPages.filter((entry) => entry === 2)).toHaveLength(2);
    } finally { await loaded.cleanup(); }
  }

  const malformed = await openExtensionPage(testInfo, "/?s=seeders&o=desc&failure=malformed");
  try {
    await malformed.page.getByRole("button", { name: "Show more results" }).click();
    await expect(malformed.page.locator(".magnet-notification").filter({ hasText: "unexpected page" })).toBeVisible();
    await expect(malformed.page.locator(".ne-show-more__button")).toHaveText("Show more");
    await expect(malformed.page.locator('[data-fixture-row="page-two"]')).toHaveCount(0);
  } finally { await malformed.cleanup(); }
});

test("show more stops after ten unique all-old pages and can continue", async ({}, testInfo) => {
  requestPages = [];
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month&fixture=limit");
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

test("minimum-seeder and file-size filters use canonical Nyaa columns together", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo, "/?s=seeders&o=desc&dateFilter=month");
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

test("new controls render without overlap in light and dark desktop/mobile views", async ({}, testInfo) => {
  const { page, cleanup } = await openExtensionPage(testInfo);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:.001ms!important;animation-delay:0ms!important;transition-duration:.001ms!important;transition-delay:0ms!important;scroll-behavior:auto!important}" });
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const dark of [false, true]) {
        const currentDark = await page.locator("body").evaluate((body) => body.classList.contains("dark"));
        if (currentDark !== dark) await page.locator("#theme-toggle").click();
        await expect(page.locator("body")).toHaveClass(dark ? /dark/ : /^(?!.*dark).*$/);
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
