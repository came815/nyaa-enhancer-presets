import { sendMessageToNyaaTabs } from "../shared/domains.js";

const SETTINGS_MESSAGES = new Set([
  "settingChanged", "keywordsUpdated", "monitoredUsersUpdated", "refreshMonitoring",
]);

export function initSettingsRelay() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== "relaySettings") return;
    if (sender.id !== chrome.runtime.id || !SETTINGS_MESSAGES.has(request.message?.type)) {
      sendResponse({ ok: false, error: "Invalid settings notification" });
      return;
    }
    sendMessageToNyaaTabs(request.message, { excludeTabId: sender.tab?.id }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: "Settings notification failed" }),
    );
    return true;
  });
}
