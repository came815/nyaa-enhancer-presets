// Minimal Chrome API surface for the localhost synthetic preview only.
// The Playwright extension tests do not load this file.
(() => {
  const chromeApi = window.chrome || {};
  const stores = { sync: {}, local: {} };
  const reply = (value, callback) => {
    if (typeof callback === "function") callback(value);
    return Promise.resolve(value);
  };
  const area = (store) => ({
    get(query, callback) {
      const result = {};
      if (query == null) {
        Object.assign(result, store);
      } else if (Array.isArray(query)) {
        for (const key of query) if (key in store) result[key] = store[key];
      } else if (typeof query === "object") {
        for (const [key, fallback] of Object.entries(query)) result[key] = key in store ? store[key] : fallback;
      } else if (query in store) {
        result[query] = store[query];
      }
      return reply(result, callback);
    },
    set(values, callback) { Object.assign(store, values || {}); return reply(undefined, callback); },
    remove(keys, callback) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key]; return reply(undefined, callback); },
  });

  chromeApi.runtime ||= {};
  chromeApi.runtime.getURL ||= (path) => `/src/chrome/${path}`;
  chromeApi.runtime.getManifest ||= () => ({ manifest_version: 3, name: "Nyaa Enhancer Presets synthetic preview", version: "1.15.0" });
  chromeApi.runtime.sendMessage ||= (_message, callback) => reply({ ok: false, error: "Synthetic fixture" }, callback);
  chromeApi.runtime.onMessage ||= { addListener() {} };
  chromeApi.storage ||= {};
  chromeApi.storage.sync ||= area(stores.sync);
  chromeApi.storage.local ||= area(stores.local);
  chromeApi.storage.onChanged ||= { addListener() {} };
  window.chrome = chromeApi;
})();
