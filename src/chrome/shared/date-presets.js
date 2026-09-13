// Nyaa Enhancer Presets modification, 2026-09-13. GPL-3.0.
export const DATE_PRESETS = Object.freeze([
  { key: "day", label: "Day", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
  { key: "3month", label: "3Month", days: 90 },
  { key: "year", label: "Year", days: 365 },
]);

export function normalizeDatePreset(value) {
  if (value === "30days") return "month"; // Upstream bookmark compatibility.
  return DATE_PRESETS.some((preset) => preset.key === value) ? value : "month";
}

export function readDatePresetOptions(input, now = Math.floor(Date.now() / 1000)) {
  const url = new URL(input);
  const datePreset = normalizeDatePreset(url.searchParams.get("dateFilter"));
  const rawTime = url.searchParams.get("dateAt");
  const parsedTime = rawTime ? Number(rawTime) : NaN;
  const referenceTime = Number.isSafeInteger(parsedTime) && parsedTime > 0 && parsedTime <= now
    ? parsedTime : now;
  return { datePreset, referenceTime };
}

export function isWithinDatePreset(timestamp, options) {
  const preset = DATE_PRESETS.find((entry) => entry.key === options.datePreset);
  return !!preset && Number.isFinite(timestamp) && timestamp > 0 &&
    timestamp >= options.referenceTime - preset.days * 86400 && timestamp <= options.referenceTime;
}

export function setDatePresetParams(url, options) {
  url.searchParams.set("dateFilter", options.datePreset);
  url.searchParams.set("dateAt", String(options.referenceTime));
  return url;
}

export function buildPresetUrl(input, preset, now = Math.floor(Date.now() / 1000)) {
  const url = new URL(input);
  setDatePresetParams(url, { datePreset: normalizeDatePreset(preset), referenceTime: now });
  for (const key of ["p", "page", "offset"]) url.searchParams.delete(key);
  url.searchParams.set("s", "seeders");
  url.searchParams.set("o", "desc");
  return url;
}

export function preserveDateNavigation(target, current) {
  const url = new URL(target, current);
  const source = new URL(current);
  if (url.origin !== source.origin || (url.pathname !== "/" && !url.pathname.startsWith("/user/")) ||
      url.searchParams.get("page") === "rss") return url;
  setDatePresetParams(url, readDatePresetOptions(current));
  for (const key of ["s", "o", "sizeMin", "sizeMax"]) {
    if (!url.searchParams.has(key) && source.searchParams.has(key)) {
      url.searchParams.set(key, source.searchParams.get(key));
    }
  }
  return url;
}
