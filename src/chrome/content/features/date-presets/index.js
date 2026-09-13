// Nyaa Enhancer Presets modification, 2026-09-13. GPL-3.0.
import { DATE_PRESETS, buildPresetUrl, preserveDateNavigation, readDatePresetOptions, setDatePresetParams } from "../../../shared/date-presets.js";
import { getPageFlags } from "../../core/page.js";
import { createLanguageControl, getLanguage, t } from "../../../shared/i18n.js";

export function initializeDatePresets() {
  if (!getPageFlags().isList || !document.querySelector("table.torrent-list")) return true;
  const url = new URL(window.location.href);
  const options = readDatePresetOptions(url.href);
  setDatePresetParams(url, options);
  // Sorting is server-side: changing the address with replaceState alone would lie about the rows.
  if (!url.searchParams.has("s") || !url.searchParams.has("o")) {
    if (!url.searchParams.has("s")) url.searchParams.set("s", "seeders");
    if (!url.searchParams.has("o")) url.searchParams.set("o", "desc");
    window.location.replace(url.href);
    return false;
  }
  history.replaceState(history.state, "", url.href);
  const table = document.querySelector(".table-responsive:has(table.torrent-list)");
  if (!table || document.getElementById("ne-date-presets")) return true;

  const panel = document.createElement("section");
  panel.id = "ne-date-presets";
  panel.className = "ne-date-presets";
  panel.lang = getLanguage();
  panel.setAttribute("aria-label", t("Upload period"));
  const label = document.createElement("span");
  label.className = "ne-date-presets__label";
  label.textContent = t("Uploaded within");
  const group = document.createElement("div");
  group.className = "ne-date-presets__choices";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("Date preset"));
  for (const preset of DATE_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t(preset.label);
    button.dataset.preset = preset.key;
    button.setAttribute("aria-pressed", String(options.datePreset === preset.key));
    button.title = t("Last {hours} hours ({days} days)", { hours: preset.days * 24, days: preset.days });
    button.addEventListener("click", () => window.location.assign(buildPresetUrl(window.location.href, preset.key).href));
    group.appendChild(button);
  }
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "ne-date-presets__refresh";
  refresh.textContent = t("Refresh");
  refresh.title = t("Start again from now, sorted by seeders");
  refresh.addEventListener("click", () => window.location.assign(buildPresetUrl(window.location.href, options.datePreset).href));
  const note = document.createElement("span");
  note.className = "ne-date-presets__note";
  note.textContent = t("As of {time}. Loaded results only.", { time: new Date(options.referenceTime * 1000).toLocaleString(getLanguage() === "ja" ? "ja-JP" : "en-US") });
  panel.append(label, group, refresh, createLanguageControl(), note);
  table.insertAdjacentElement("beforebegin", panel);
  preserveListNavigation();
  return true;
}

export function preserveListNavigation() {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) continue;
    const target = new URL(href, window.location.href);
    if (target.protocol !== "https:" && target.protocol !== "http:") continue;
    const preserved = preserveDateNavigation(target.href, window.location.href);
    // Leave non-list links untouched: native view/settings selectors rely on
    // their relative href, and these links do not need period parameters.
    if (preserved.href !== target.href) anchor.href = preserved.href;
  }
  for (const form of document.querySelectorAll("form")) {
    const target = new URL(form.getAttribute("action") || window.location.href, window.location.href);
    if (form.method.toLowerCase() !== "get" || target.origin !== location.origin ||
        (target.pathname !== "/" && !target.pathname.startsWith("/user/")) || !form.querySelector('[name="q"]')) continue;
    const setHidden = (key, value) => {
      let input = form.querySelector(`input[name="${key}"]`);
      if (!input) { input = document.createElement("input"); input.type = "hidden"; input.name = key; form.appendChild(input); }
      input.value = value;
    };
    const setSearchConditions = () => {
      const current = new URL(window.location.href);
      setHidden("dateFilter", readDatePresetOptions(current.href).datePreset);
      setHidden("dateAt", String(Math.floor(Date.now() / 1000)));
      setHidden("s", current.searchParams.get("s") || "seeders");
      setHidden("o", current.searchParams.get("o") || "desc");
      for (const key of ["sizeMin", "sizeMax"]) {
        if (current.searchParams.has(key)) setHidden(key, current.searchParams.get(key));
      }
      for (const input of form.querySelectorAll('[name="p"], [name="page"], [name="offset"]')) input.remove();
    };
    setSearchConditions();
    form.addEventListener("submit", setSearchConditions);
  }
}
