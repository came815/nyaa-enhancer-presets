import { initI18n } from "../../shared/i18n.js";
import { handleSettingsPage } from "../../content/pages/settings/index.js";

await initI18n();
await handleSettingsPage();
