import assert from "node:assert/strict";
import test from "node:test";
import { DATE_PRESETS, buildPresetUrl, isWithinDatePreset, normalizeDatePreset, preserveDateNavigation, readDatePresetOptions } from "../../src/chrome/shared/date-presets.js";

const now = 1_700_000_000;

test("all rolling periods include exact start/end boundaries and reject future or invalid timestamps", () => {
  for (const preset of DATE_PRESETS) {
    const options = { datePreset: preset.key, referenceTime: now };
    assert.equal(isWithinDatePreset(now, options), true, `${preset.key} includes reference time`);
    assert.equal(isWithinDatePreset(now - preset.days * 86_400, options), true, `${preset.key} includes start`);
    assert.equal(isWithinDatePreset(now - preset.days * 86_400 - 1, options), false, `${preset.key} excludes before start`);
    assert.equal(isWithinDatePreset(now + 1, options), false, `${preset.key} excludes future`);
    for (const invalid of [0, -1, NaN, Infinity, "not-a-time"]) assert.equal(isWithinDatePreset(invalid, options), false);
  }
});

test("legacy 30days and invalid date presets default to month", () => {
  assert.equal(normalizeDatePreset("30days"), "month");
  assert.equal(normalizeDatePreset("unknown"), "month");
  assert.equal(normalizeDatePreset(null), "month");
});

test("read options preserves a valid fixed dateAt and replaces invalid or future values", () => {
  assert.deepEqual(readDatePresetOptions("https://fixture.test/?dateFilter=week&dateAt=1699999999", now), { datePreset: "week", referenceTime: 1_699_999_999 });
  assert.deepEqual(readDatePresetOptions("https://fixture.test/?dateFilter=day&dateAt=invalid", now), { datePreset: "day", referenceTime: now });
  assert.deepEqual(readDatePresetOptions(`https://fixture.test/?dateAt=${now + 1}`, now), { datePreset: "month", referenceTime: now });
});

test("preset URLs retain search/category/user scope, reset paging, and force seeder descending", () => {
  const result = buildPresetUrl("https://fixture.test/user/alice?q=synthetic&c=1_2&p=4&page=7&offset=40&s=date&o=asc", "week", now);
  assert.equal(result.pathname, "/user/alice");
  assert.equal(result.searchParams.get("q"), "synthetic");
  assert.equal(result.searchParams.get("c"), "1_2");
  assert.equal(result.searchParams.get("dateFilter"), "week");
  assert.equal(result.searchParams.get("dateAt"), String(now));
  assert.equal(result.searchParams.get("s"), "seeders");
  assert.equal(result.searchParams.get("o"), "desc");
  for (const key of ["p", "page", "offset"]) assert.equal(result.searchParams.has(key), false);
});

test("navigation keeps selected period and fixed time while respecting explicit sort and skipping outside list links", () => {
  const current = "https://fixture.test/?q=synthetic&dateFilter=year&dateAt=1660000000&s=seeders&o=desc";
  const explicit = preserveDateNavigation("/?p=2&s=date&o=asc", current);
  assert.equal(explicit.searchParams.get("dateFilter"), "year");
  assert.equal(explicit.searchParams.get("dateAt"), "1660000000");
  assert.equal(explicit.searchParams.get("s"), "date");
  assert.equal(explicit.searchParams.get("o"), "asc");
  assert.equal(preserveDateNavigation("https://external.test/?p=2", current).href, "https://external.test/?p=2");
  assert.equal(preserveDateNavigation("/view/1", current).pathname, "/view/1");
  assert.equal(preserveDateNavigation("/?page=rss", current).searchParams.has("dateFilter"), false);
});
