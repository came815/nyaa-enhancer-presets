export const NYAA_DOMAINS = [
  "nyaa.si",
  "nya.iss.one",
  "nyaa.ink",
  "nyaa.land",
  "nyaa.digital",
  "ny.iss.one",
];

export const NYAA_MATCHES = NYAA_DOMAINS.map((domain) => `*://*.${domain}/*`);

export const NYAA_SETTINGS_EXTENSION_PATH = "pages/settings/index.html";

export function isNyaaSite(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && NYAA_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
  } catch { return false; }
}

export function isExtensionPage() {
  return typeof location !== "undefined" && location.protocol === "chrome-extension:";
}

export function getNyaaSettingsExtensionUrl() {
  return chrome.runtime.getURL(NYAA_SETTINGS_EXTENSION_PATH);
}

export async function queryNyaaTabs() {
  try {
    return await chrome.tabs.query({ url: NYAA_MATCHES });
  } catch {
    return [];
  }
}

export async function sendMessageToNyaaTabs(message, { excludeTabId } = {}) {
  // Content scripts cannot use chrome.tabs. The service worker owns tab lookup
  // and derives the excluded source tab from Chrome's trusted sender metadata.
  if (!chrome.tabs?.query) {
    const result = await chrome.runtime.sendMessage({ type: "relaySettings", message });
    if (!result?.ok) throw new Error(result?.error || "Settings notification failed");
    return;
  }
  const tabs = await queryNyaaTabs();
  await Promise.all(
    tabs.map((tab) => {
      if (!tab?.id || tab.id === excludeTabId) return Promise.resolve();
      return chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }),
  );
}

export async function resolveNyaaSettingsTarget() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && isNyaaSite(active.url)) {
    return {
      url: `${new URL(active.url).origin}/settings`,
      tabId: active.id,
      sameTab: true,
    };
  }

  const nyaaTabs = await queryNyaaTabs();
  const existing = nyaaTabs.find((tab) => tab.url);
  if (existing?.url) {
    return {
      url: `${new URL(existing.url).origin}/settings`,
      tabId: null,
      sameTab: false,
    };
  }

  return {
    url: getNyaaSettingsExtensionUrl(),
    tabId: null,
    sameTab: false,
  };
}
