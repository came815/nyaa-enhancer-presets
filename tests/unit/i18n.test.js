import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const sync = {};
const local = {};

function read(store, query) {
  if (Array.isArray(query)) return Object.fromEntries(query.filter((key) => key in store).map((key) => [key, store[key]]));
  return Object.fromEntries(Object.entries(query || {}).map(([key, fallback]) => [key, key in store ? store[key] : fallback]));
}

function storageArea(store) {
  return {
    get(query, callback) { callback(read(store, query)); },
    set(items, callback) { Object.assign(store, items); callback(); },
    remove(keys, callback) { for (const key of keys) delete store[key]; callback(); },
  };
}

globalThis.chrome = {
  runtime: { lastError: null },
  storage: { sync: storageArea(sync), local: storageArea(local) },
};

const { applyTranslations, getLanguage, initI18n, normalizeLanguage, saveLanguage, t } = await import("../../src/chrome/shared/i18n.js");

test("language normalization defaults unknown values to Japanese and persists an explicit switch", async () => {
  delete sync.uiLanguage;
  await initI18n();
  assert.equal(getLanguage(), "ja");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("EN"), "ja");
  assert.equal(normalizeLanguage(null), "ja");

  await saveLanguage("en");
  assert.equal(sync.uiLanguage, "en");
  assert.equal(getLanguage(), "en");
  await saveLanguage("unexpected");
  assert.equal(sync.uiLanguage, "ja");
  assert.equal(getLanguage(), "ja");
});

test("translation falls back safely and keeps interpolated user data literal", async () => {
  sync.uiLanguage = "ja";
  await initI18n();
  assert.equal(t("An intentionally missing key"), "An intentionally missing key");
  assert.equal(t("Missing {user}", { user: '<img src=x onerror="unexpected()">' }), 'Missing <img src=x onerror="unexpected()">');
  assert.equal(t("Missing {user}"), "Missing {user}");

  let nativeText = "Synthetic user title <b>must stay data</b>";
  const nativeElement = {
    hasAttribute: () => false,
    getAttribute: () => null,
    setAttribute: () => { throw new Error("unmarked native attributes must not be rewritten"); },
    get textContent() { return nativeText; },
    set textContent(value) { nativeText = value; },
  };
  applyTranslations({ querySelectorAll: () => [nativeElement], matches: () => false });
  assert.equal(nativeText, "Synthetic user title <b>must stay data</b>");
});

test("message catalogs do not assign conflicting Japanese translations to one English key", async () => {
  const sharedDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../src/chrome/shared");
  const catalogFiles = (await readdir(sharedDirectory)).filter((name) => /^messages-.*\.js$/.test(name));
  const translations = new Map();
  for (const file of catalogFiles) {
    const { default: catalog } = await import(pathToFileURL(join(sharedDirectory, file)).href);
    for (const [english, japanese] of Object.entries(catalog)) {
      if (!translations.has(english)) translations.set(english, japanese);
      else assert.equal(japanese, translations.get(english), `${english} must agree across catalogs`);
    }
  }
  assert.equal(translations.get("Language"), "表示言語");
  assert.equal(translations.get("Uploaded within"), "アップロード期間");
});
