import { setPrefsSaveErrorHandler } from "../shared/prefs.js";
import { initI18n, t } from "../shared/i18n.js";
import { buildCtx } from "./core/ctx.js";
import { enhanceTorrentDescriptionPanel } from "./core/description-tabs.js";
import { initMessaging } from "./core/messaging.js";
import { showNotification } from "./core/notifications.js";
import { observeTableChanges } from "./core/observer.js";
import { dispatchFeatureHook, setFeatures } from "./core/registry.js";
import { features } from "./features/index.js";
import { initializeDatePresets } from "./features/date-presets/index.js";

setPrefsSaveErrorHandler((message) => {
  showNotification(t("Failed to save settings: {message}", { message }), false);
});

setFeatures(features);
const ctx = buildCtx(features);

async function initializeExtension(isInitialLoad = false) {
  await initI18n();
  if (!initializeDatePresets()) return;
  ctx.isInitialLoad = isInitialLoad;
  await dispatchFeatureHook("init", ctx);
  enhanceTorrentDescriptionPanel();
  observeTableChanges();
  await dispatchFeatureHook("afterObserver", ctx);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initializeExtension(true);
  });
} else {
  initializeExtension(true);
}

initMessaging();
