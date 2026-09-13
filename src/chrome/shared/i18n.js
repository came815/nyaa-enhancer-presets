// Nyaa Enhancer Presets localization, 2026-09-14. GPL-3.0.
import { getPreferencesAsync, savePreferencesAsync } from "./prefs.js";
import common from "./messages-common.js";
import controls from "./messages-controls.js";
import settings from "./messages-settings.js";
import popup from "./messages-popup.js";
import extras from "./messages-extras.js";
import integrations from "./messages-integrations.js";

const japanese = Object.assign(Object.create(null), common, controls, settings, popup, extras, integrations);
let language = "ja";

export function normalizeLanguage(value) {
  return value === "en" ? "en" : "ja";
}

export function getLanguage() { return language; }

export async function initI18n() {
  const preferences = await getPreferencesAsync({ uiLanguage: "ja" });
  language = normalizeLanguage(preferences.uiLanguage);
  return language;
}

export function t(message, params = {}) {
  const source = String(message);
  const translated = language === "ja" && Object.hasOwn(japanese, source) ? japanese[source] : source;
  return translated.replace(/\{(\w+)\}/g, (placeholder, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : placeholder,
  );
}

export async function saveLanguage(value) {
  const nextLanguage = normalizeLanguage(value);
  await savePreferencesAsync({ uiLanguage: nextLanguage });
  language = nextLanguage;
}

// Only explicitly marked extension-owned elements are translated. No page-wide
// text substitution: torrent titles, descriptions and user inputs remain data.
export function applyTranslations(root = document) {
  const attributes = ["title", "placeholder", "aria-label", "alt"];
  const selector = ["[data-i18n]", ...attributes.map((name) => `[data-i18n-${name}]`)].join(",");
  const elements = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) elements.unshift(root);
  for (const element of elements) {
    if (element.hasAttribute("data-i18n")) element.textContent = t(element.getAttribute("data-i18n"));
    for (const attribute of attributes) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key !== null) element.setAttribute(attribute, t(key));
    }
  }
}

export function createLanguageControl({ id = "ne-language-select" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "ne-language-control";
  wrapper.lang = getLanguage();
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = t("Language");
  const select = document.createElement("select");
  select.id = id;
  select.title = t("Changing language reloads this page.");
  for (const [value, text] of [["ja", "日本語"], ["en", "English"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.lang = value;
    select.appendChild(option);
  }
  select.value = getLanguage();
  const error = document.createElement("span");
  error.className = "ne-language-control__error";
  error.setAttribute("role", "status");
  error.hidden = true;
  select.addEventListener("change", async () => {
    const previous = getLanguage();
    select.disabled = true;
    error.hidden = true;
    try {
      await saveLanguage(select.value);
      window.location.reload();
    } catch {
      select.value = previous;
      select.disabled = false;
      error.textContent = t("Could not save language. Try again.");
      error.hidden = false;
    }
  });
  wrapper.append(label, select, error);
  return wrapper;
}
