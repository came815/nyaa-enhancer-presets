import {
  loadStoredPreferences,
  savePreferences,
} from "../../../shared/prefs.js";
import { t } from "../../../shared/i18n.js";
import {
  addCheckboxToTorrentRow,
  applyKeywordHighlights,
  applySeaDexToListPage,
  getQuickSearchClientFilterOptions,
  getTorrentIdFromRow,
  isNyaaTorrentDataRow,
  shouldHideRowByFilters,
  shouldHideRowByQuickSearch,
  showNotification,
  syncSelectionToVisibleRows,
  updateTorrentRowLinkActions,
  withTorrentTableObserverPaused,
} from "../../internal.js";

export const NE_SHOW_MORE_SKIP_DELAY_MS = 1500;
export const NE_SHOW_MORE_FETCH_TIMEOUT_MS = 20_000;
export const NE_SHOW_MORE_MAX_PAGES_PER_CLICK = 10;
export const NE_SHOW_MORE_RATE_LIMIT_PAUSE_MS = 15_000;

export const neShowMoreState = {
  initialized: false,
  loading: false,
  loadingLabel: "Loading…",
  currentPage: 1,
  hasMore: false,
  loadedPages: 0,
  visibleTotal: 0,
  initialPage: 1,
  lastRequestStartedAt: 0,
  requestController: null,
  retryAt: 0,
  retryTimer: null,
  stoppedAtLimit: false,
  autoLoadEnabled: false,
  autoPreferenceLoaded: false,
  autoPaused: false,
  autoPauseMessage: "",
  autoObserver: null,
  autoCheckTimer: null,
  visibilityHandler: null,
  preferenceSaveQueue: Promise.resolve(),
};

export function getNyaaPageNumberFromHref(href, base = window.location.href) {
  try {
    const p = parseInt(new URL(href, base).searchParams.get("p"), 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  } catch {
    return 1;
  }
}

// Start from the current URL so dateFilter/dateAt and other client parameters survive.
export function buildNyaaPageUrl(pageNumber) {
  const url = new URL(window.location.href);
  if (pageNumber <= 1) url.searchParams.delete("p");
  else url.searchParams.set("p", String(pageNumber));
  return url.toString();
}

export function getMaxPageNumberFromDocument(doc) {
  let max = 1;
  doc.querySelectorAll("ul.pagination a").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href && href !== "#") {
      max = Math.max(max, getNyaaPageNumberFromHref(href));
    }
  });
  const active = parseInt(
    doc.querySelector("ul.pagination li.active a")?.textContent,
    10,
  );
  return Number.isFinite(active) ? Math.max(max, active) : max;
}

export function documentHasNextNyaaPage(doc, currentPage) {
  const next = doc.querySelector('ul.pagination a[rel="next"]');
  if (next) {
    const href = next.getAttribute("href");
    if (
      href &&
      href !== "#" &&
      !next.closest("li")?.classList.contains("disabled")
    ) {
      return getNyaaPageNumberFromHref(href) > currentPage;
    }
  }
  return getMaxPageNumberFromDocument(doc) > currentPage;
}

export function getExistingTorrentIds() {
  const ids = new Set();
  document.querySelectorAll("table.torrent-list tbody tr").forEach((row) => {
    const id = getTorrentIdFromRow(row);
    if (id) ids.add(id);
  });
  return ids;
}

export function getShowMoreButton() {
  return document.querySelector(".ne-show-more__button");
}

export function getShowMoreCancelButton() {
  return document.querySelector(".ne-show-more__cancel");
}

export function getShowMoreStatus() {
  return document.querySelector(".ne-show-more__status");
}

export function setShowMoreButtonContent(
  button,
  {
    loading = false,
    done = false,
    continueLoading = false,
    retry = false,
    loadingLabel = "Loading…",
  } = {},
) {
  if (!button) return;
  if (loading) {
    button.innerHTML = `<i class="fa fa-spinner fa-spin" aria-hidden="true"></i> ${t(loadingLabel)}`;
  } else if (done) {
    button.textContent = t("No more results");
  } else if (retry) {
    button.innerHTML = `<i class="fa fa-refresh" aria-hidden="true"></i> ${t("Retry")}`;
  } else if (continueLoading) {
    button.innerHTML =
      `<i class="fa fa-angle-down" aria-hidden="true"></i> ${t("Continue loading")}`;
  } else {
    button.innerHTML =
      `<i class="fa fa-angle-down" aria-hidden="true"></i> ${t("Show more")}`;
  }
}

export function getShowMoreStatusText() {
  neShowMoreState.visibleTotal = Array.from(document.querySelectorAll("table.torrent-list tbody tr"))
    .filter((row) => isNyaaTorrentDataRow(row) && row.style.display !== "none").length;
  const pages = t(neShowMoreState.loadedPages === 1 ? "{count} loaded page" : "{count} loaded pages", { count: neShowMoreState.loadedPages });
  const visible = t(neShowMoreState.visibleTotal === 1 ? "{count} visible result" : "{count} visible results", { count: neShowMoreState.visibleTotal });
  const startedLater = neShowMoreState.initialPage > 1;
  const scope = startedLater ? t(" · loaded pages only") : "";

  let detail = "Ready to load more.";
  if (neShowMoreState.loading) detail = neShowMoreState.loadingLabel;
  if (neShowMoreState.retryAt > Date.now()) {
    detail = t("Rate limited. Retry in {seconds}s; next page unchanged.", { seconds: Math.ceil((neShowMoreState.retryAt - Date.now()) / 1000) });
  } else if (neShowMoreState.autoPauseMessage) {
    detail = neShowMoreState.autoPauseMessage;
  } else if (!neShowMoreState.hasMore) {
    detail = "Available pages exhausted.";
  } else if (neShowMoreState.stoppedAtLimit) {
    detail = "10-page limit reached; continue when ready.";
  }
  return `${pages} · ${visible} · ${t(detail)}${scope}`;
}

export function getAutoLoadToggle() {
  return document.querySelector(".ne-auto-load__toggle");
}

export function getAutoLoadStatus() {
  return document.querySelector(".ne-auto-load__status");
}

export function getAutoLoadStatusText() {
  const pages = t(neShowMoreState.loadedPages === 1 ? "{count} page" : "{count} pages", { count: neShowMoreState.loadedPages });
  const visible = t(neShowMoreState.visibleTotal === 1 ? "{count} result" : "{count} results", { count: neShowMoreState.visibleTotal });
  let state;
  if (!neShowMoreState.autoPreferenceLoaded) {
    state = "Loading preference…";
  } else if (neShowMoreState.loading) {
    state = neShowMoreState.loadingLabel;
  } else if (!neShowMoreState.autoLoadEnabled) {
    state = "Automatic loading off";
  } else if (neShowMoreState.retryAt > Date.now()) {
    state = t("Cooldown: retry in {seconds}s", { seconds: Math.ceil((neShowMoreState.retryAt - Date.now()) / 1000) });
  } else if (neShowMoreState.autoPaused) {
    state = neShowMoreState.autoPauseMessage || "Automatic loading paused";
  } else if (!neShowMoreState.hasMore) {
    state = "Available pages exhausted";
  } else if (document.hidden) {
    state = "Waiting for this tab to be visible";
  } else {
    state = "Scroll for more";
  }
  return `${pages} · ${visible} · ${t(state)}`;
}

export function updateAutoLoadControls() {
  const toggle = getAutoLoadToggle();
  const status = getAutoLoadStatus();
  if (status) status.textContent = getAutoLoadStatusText();
  if (!toggle) return;
  toggle.disabled =
    !neShowMoreState.autoPreferenceLoaded ||
    (neShowMoreState.autoPaused && neShowMoreState.retryAt > Date.now());
  toggle.setAttribute(
    "aria-pressed",
    String(neShowMoreState.autoLoadEnabled && !neShowMoreState.autoPaused),
  );
  toggle.textContent =
    neShowMoreState.autoLoadEnabled && !neShowMoreState.autoPaused
      ? t("Pause auto")
      : t("Resume auto");
}

export function updateShowMoreButtonState() {
  const button = getShowMoreButton();
  const cancel = getShowMoreCancelButton();
  const status = getShowMoreStatus();
  if (status) status.textContent = getShowMoreStatusText();
  if (!button) return;

  const paused = neShowMoreState.retryAt > Date.now();
  button.disabled = neShowMoreState.loading || !neShowMoreState.hasMore || paused;
  button.setAttribute("aria-busy", neShowMoreState.loading ? "true" : "false");
  setShowMoreButtonContent(button, {
    loading: neShowMoreState.loading,
    done: !neShowMoreState.hasMore,
    continueLoading: neShowMoreState.stoppedAtLimit,
    retry: neShowMoreState.retryAt > 0,
    loadingLabel: neShowMoreState.loadingLabel,
  });
  if (cancel) cancel.hidden = !neShowMoreState.loading;
  updateAutoLoadControls();
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function pauseAutoLoading(message = "Automatic loading is paused.") {
  neShowMoreState.autoPaused = true;
  neShowMoreState.autoPauseMessage = message;
  updateShowMoreButtonState();
}

export function canAutoLoad({ ignoreLoading = false } = {}) {
  return (
    neShowMoreState.autoPreferenceLoaded &&
    neShowMoreState.autoLoadEnabled &&
    !neShowMoreState.autoPaused &&
    neShowMoreState.hasMore &&
    (ignoreLoading || !neShowMoreState.loading) &&
    !document.hidden
  );
}

export function isShowMoreNearViewport() {
  const sentinel = document.querySelector(".ne-show-more");
  if (!sentinel) return false;
  return sentinel.getBoundingClientRect().top <= window.innerHeight + 600;
}

export function queueAutoLoadCheck() {
  clearTimeout(neShowMoreState.autoCheckTimer);
  neShowMoreState.autoCheckTimer = setTimeout(() => {
    if (canAutoLoad() && isShowMoreNearViewport()) {
      loadNextNyaaResultsPage({ auto: true });
    }
  }, 0);
}

export function waitForVisibleTab(signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function finish() {
      document.removeEventListener("visibilitychange", onChange);
      signal?.removeEventListener("abort", abort);
    }
    function onChange() {
      if (!document.hidden) {
        finish();
        resolve();
      }
    }
    function abort() {
      finish();
      reject(new DOMException("Aborted", "AbortError"));
    }
    document.addEventListener("visibilitychange", onChange);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function setupAutoLoadObserver() {
  if (neShowMoreState.autoObserver || !window.IntersectionObserver) return;
  const sentinel = document.querySelector(".ne-show-more");
  if (!sentinel) return;
  neShowMoreState.autoObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) queueAutoLoadCheck();
    },
    { rootMargin: "0px 0px 600px 0px" },
  );
  neShowMoreState.autoObserver.observe(sentinel);
  neShowMoreState.visibilityHandler = () => {
    updateShowMoreButtonState();
    if (!document.hidden) queueAutoLoadCheck();
  };
  document.addEventListener("visibilitychange", neShowMoreState.visibilityHandler);
}

export async function toggleAutoLoading() {
  const resuming =
    !neShowMoreState.autoLoadEnabled || neShowMoreState.autoPaused;
  neShowMoreState.autoLoadEnabled = resuming;
  neShowMoreState.autoPaused = false;
  neShowMoreState.autoPauseMessage = "";
  if (!resuming) {
    cancelShowMoreLoading();
    pauseAutoLoading("Automatic loading is paused.");
  }
  updateShowMoreButtonState();
  const value = neShowMoreState.autoLoadEnabled;
  neShowMoreState.preferenceSaveQueue = neShowMoreState.preferenceSaveQueue
    .catch(() => {})
    .then(() => savePreferences({ autoLoadMore: value }));
  await neShowMoreState.preferenceSaveQueue;
  if (resuming) queueAutoLoadCheck();
}

export function applyFiltersToShowMoreRows(rows, prefs) {
  const options = getQuickSearchClientFilterOptions();
  let hidden = 0;
  rows.forEach((row) => {
    const hide =
      shouldHideRowByFilters(row, prefs) ||
      shouldHideRowByQuickSearch(row, options);
    row.style.display = hide ? "none" : "";
    if (hide) hidden++;
  });
  return { hidden, visible: rows.length - hidden, total: rows.length };
}

export function animateNewTorrentRows(rows) {
  const visibleRows = rows.filter((row) => row.style.display !== "none");
  if (
    !visibleRows.length ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  visibleRows.forEach((row, index) => {
    row.classList.add("ne-show-more-row-enter");
    row.style.animationDelay = `${Math.min(index, 16) * 18}ms`;
    const cleanup = () => {
      row.classList.remove("ne-show-more-row-enter");
      row.style.animationDelay = "";
      row.removeEventListener("animationend", cleanup);
    };
    row.addEventListener("animationend", cleanup);
  });
}

export function resolveAnimetoshoLinksForRows(rows, prefs) {
  if (!prefs.showATLinks) return;
  rows.forEach((row) => {
    if (row.style.display !== "none") updateTorrentRowLinkActions(row, prefs);
  });
}

export function prepareImportedShowMoreRow(sourceRow, pageNumber, prefs) {
  const row = document.importNode(sourceRow, true);
  row.querySelectorAll("script").forEach((script) => script.remove());
  row.classList.add("ne-show-more-page");
  row.dataset.nePage = String(pageNumber);
  addCheckboxToTorrentRow(row, prefs);
  updateTorrentRowLinkActions(row, prefs, { deferAnimetosho: true });
  return row;
}

export async function fetchAndAppendNyaaPage(tableBody, prefs, signal) {
  const nextPage = neShowMoreState.currentPage + 1;
  const response = await fetch(buildNyaaPageUrl(nextPage), {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Failed to load page (${response.status})`);
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }

  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const sourceBody = doc.querySelector("table.torrent-list tbody");
  if (!sourceBody) {
    const error = new Error("Unexpected Nyaa response");
    error.code = "UNEXPECTED_HTML";
    throw error;
  }

  const ids = getExistingTorrentIds();
  const newRows = [];
  if (!Array.from(sourceBody.querySelectorAll("tr")).some(isNyaaTorrentDataRow) && documentHasNextNyaaPage(doc, nextPage)) {
    const error = new Error("Empty table with more pages is not a valid results page");
    error.code = "UNEXPECTED_HTML";
    throw error;
  }
  for (const sourceRow of sourceBody.querySelectorAll("tr")) {
    if (!isNyaaTorrentDataRow(sourceRow)) continue;
    const id = getTorrentIdFromRow(sourceRow);
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    newRows.push(prepareImportedShowMoreRow(sourceRow, nextPage, prefs));
  }

  const filtered = applyFiltersToShowMoreRows(newRows, prefs);
  const visibleRows = newRows.filter((row) => row.style.display !== "none");
  await withTorrentTableObserverPaused(async () => {
    newRows.forEach((row) => tableBody.appendChild(row));
    applyKeywordHighlights(newRows, prefs);
    if (visibleRows.length) {
      animateNewTorrentRows(newRows);
      resolveAnimetoshoLinksForRows(newRows, prefs);
    }
  });
  syncSelectionToVisibleRows();

  // Advance only after successful response parsing and DOM append.
  neShowMoreState.currentPage = nextPage;
  neShowMoreState.hasMore = documentHasNextNyaaPage(doc, nextPage);
  neShowMoreState.loadedPages++;
  neShowMoreState.visibleTotal += filtered.visible;
  return { added: newRows.length, visible: filtered.visible, visibleRows };
}

function getRateLimitPause(error) {
  const value = error?.retryAfter?.trim();
  const seconds = value && /^\d+$/.test(value) ? Number(value) : NaN;
  const date = value ? Date.parse(value) : NaN;
  const pause = Number.isFinite(seconds) ? seconds * 1000 : date - Date.now();
  return Number.isFinite(pause) && pause > 0 ? pause : NE_SHOW_MORE_RATE_LIMIT_PAUSE_MS;
}

function scheduleCooldownRefresh() {
  clearTimeout(neShowMoreState.retryTimer);
  neShowMoreState.retryTimer = setTimeout(() => {
    // This refresh only unlocks explicit controls; it never starts a request.
    updateShowMoreButtonState();
  }, Math.max(0, neShowMoreState.retryAt - Date.now()));
}

export function cancelShowMoreLoading() {
  pauseAutoLoading("Automatic loading paused after cancellation.");
  neShowMoreState.requestController?.abort("cancelled");
}

export async function loadNextNyaaResultsPage({ auto = false } = {}) {
  if (
    neShowMoreState.loading ||
    !neShowMoreState.hasMore ||
    neShowMoreState.retryAt > Date.now() ||
    (auto && !canAutoLoad())
  ) {
    return;
  }
  const tableBody = document.querySelector("table.torrent-list tbody");
  if (!tableBody) return;

  // An accepted post-cooldown request is an explicit retry/continuation.
  if (neShowMoreState.retryAt && neShowMoreState.retryAt <= Date.now()) {
    neShowMoreState.retryAt = 0;
  }
  neShowMoreState.stoppedAtLimit = false;
  if (!auto) {
    // A manual request is an explicit retry, but does not silently resume auto-load.
    neShowMoreState.autoPauseMessage = "";
  }
  neShowMoreState.loading = true;
  neShowMoreState.loadingLabel = "Loading…";
  const controller = new AbortController();
  neShowMoreState.requestController = controller;
  updateShowMoreButtonState();

  try {
    const prefs = await loadStoredPreferences();
    let pagesThisClick = 0;
    let consecutiveNoVisiblePages = 0;
    while (
      neShowMoreState.hasMore &&
      pagesThisClick < NE_SHOW_MORE_MAX_PAGES_PER_CLICK
    ) {
      if (document.hidden) {
        neShowMoreState.loadingLabel = "Waiting for this tab to be visible…";
        updateShowMoreButtonState();
        await waitForVisibleTab(controller.signal);
        if (auto && !canAutoLoad({ ignoreLoading: true })) return;
      }
      const wait =
        NE_SHOW_MORE_SKIP_DELAY_MS -
        (Date.now() - neShowMoreState.lastRequestStartedAt);
      if (wait > 0) {
        neShowMoreState.loadingLabel = "Waiting before next request…";
        updateShowMoreButtonState();
        await delay(wait, controller.signal);
      }
      if (document.hidden) {
        neShowMoreState.loadingLabel = "Waiting for this tab to be visible…";
        updateShowMoreButtonState();
        await waitForVisibleTab(controller.signal);
        if (auto && !canAutoLoad({ ignoreLoading: true })) return;
      }
      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      neShowMoreState.loadingLabel = pagesThisClick
        ? "Looking for more results…"
        : "Loading…";
      neShowMoreState.lastRequestStartedAt = Date.now();
      updateShowMoreButtonState();

      const timeout = setTimeout(
        () => controller.abort("timeout"),
        NE_SHOW_MORE_FETCH_TIMEOUT_MS,
      );
      let result;
      try {
        result = await fetchAndAppendNyaaPage(
          tableBody,
          prefs,
          controller.signal,
        );
      } finally {
        clearTimeout(timeout);
      }

      pagesThisClick++;
      if (result.visible > 0) {
        if (prefs.showSeaDex) applySeaDexToListPage(result.visibleRows);
        break;
      }
      consecutiveNoVisiblePages++;
    }

    if (
      consecutiveNoVisiblePages >= NE_SHOW_MORE_MAX_PAGES_PER_CLICK &&
      neShowMoreState.hasMore
    ) {
      neShowMoreState.stoppedAtLimit = true;
      pauseAutoLoading(
        "Automatic loading paused after 10 consecutive pages without visible results.",
      );
    }
    if (!neShowMoreState.hasMore && neShowMoreState.visibleTotal === 0) {
      showNotification(
        t("No loaded pages contain results matching your current filters."),
        true,
      );
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (controller.signal.reason === "timeout") {
        pauseAutoLoading(
          "Automatic loading paused after a timeout. Resume when ready.",
        );
      }
      showNotification(
        controller.signal.reason === "timeout"
          ? t("Loading timed out. The next page was not advanced; try again.")
          : t("Loading cancelled. You can resume from the same next page."),
        true,
      );
    } else if (error?.status === 429) {
      neShowMoreState.retryAt = Date.now() + getRateLimitPause(error);
      scheduleCooldownRefresh();
      pauseAutoLoading(
        "Automatic loading paused after rate limiting. Resume when ready.",
      );
      showNotification(
        t("Nyaa is rate limiting requests. Loading is paused before retry."),
        false,
      );
    } else {
      pauseAutoLoading(
        error?.code === "UNEXPECTED_HTML"
          ? "Automatic loading paused: unexpected Nyaa page. Resume when ready."
          : "Automatic loading paused after an error. Resume when ready.",
      );
      console.error("Failed to load more Nyaa results:", error);
      showNotification(
        error?.code === "UNEXPECTED_HTML"
          ? t("Nyaa returned an unexpected page. Loading was stopped safely.")
          : t("Failed to load more results. Please try again."),
        false,
      );
    }
  } finally {
    neShowMoreState.loading = false;
    neShowMoreState.loadingLabel = "Loading…";
    if (neShowMoreState.requestController === controller) {
      neShowMoreState.requestController = null;
    }
    updateShowMoreButtonState();
    if (!neShowMoreState.autoPaused) queueAutoLoadCheck();
  }
}

export function addAutoLoadControls() {
  const panel = document.getElementById("ne-date-presets");
  if (!panel || panel.querySelector(".ne-date-presets__loading")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "ne-date-presets__loading";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ne-auto-load__toggle";
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", () => {
    toggleAutoLoading().catch((error) => {
      console.error("Failed to save auto-load preference:", error);
    });
  });
  const status = document.createElement("span");
  status.className = "ne-auto-load__status";
  status.setAttribute("aria-live", "polite");
  wrapper.append(toggle, status);
  panel.appendChild(wrapper);
}

export function initShowMorePagination() {
  if (neShowMoreState.initialized) return;
  const tableBody = document.querySelector("table.torrent-list tbody");
  if (!tableBody) return;
  const currentPage = getNyaaPageNumberFromHref(window.location.href);
  const tableResponsive = document.querySelector(
    ".table-responsive:has(table.torrent-list)",
  );
  if (!tableResponsive) return;

  neShowMoreState.initialized = true;
  neShowMoreState.currentPage = currentPage;
  neShowMoreState.initialPage = currentPage;
  neShowMoreState.hasMore = documentHasNextNyaaPage(document, currentPage);
  neShowMoreState.loadedPages = 1;
  neShowMoreState.visibleTotal = Array.from(tableBody.querySelectorAll("tr"))
    .filter((row) => isNyaaTorrentDataRow(row))
    .filter((row) => row.style.display !== "none").length;

  const container = document.createElement("div");
  container.className = "ne-show-more";
  const status = document.createElement("p");
  status.className = "ne-show-more__status";
  const controls = document.createElement("div");
  controls.className = "ne-show-more__controls";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ne-show-more__button";
  button.setAttribute("aria-label", t("Show more results"));
  button.title = t("Load up to 10 more pages of results");
  button.addEventListener("click", loadNextNyaaResultsPage);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ne-show-more__cancel";
  cancel.textContent = t("Cancel");
  cancel.hidden = true;
  cancel.addEventListener("click", cancelShowMoreLoading);
  controls.append(button, cancel);
  container.append(status, controls);
  tableResponsive.insertAdjacentElement("afterend", container);
  addAutoLoadControls();
  updateShowMoreButtonState();
  setupAutoLoadObserver();
  loadStoredPreferences()
    .then((prefs) => {
      neShowMoreState.autoLoadEnabled = prefs.autoLoadMore !== false;
      neShowMoreState.autoPreferenceLoaded = true;
      neShowMoreState.autoPaused = false;
      neShowMoreState.autoPauseMessage = "";
      updateShowMoreButtonState();
      queueAutoLoadCheck();
    })
    .catch((error) => {
      console.error("Failed to load auto-load preference:", error);
      neShowMoreState.autoPreferenceLoaded = true;
      pauseAutoLoading("Automatic loading preference could not be loaded.");
    });
}
