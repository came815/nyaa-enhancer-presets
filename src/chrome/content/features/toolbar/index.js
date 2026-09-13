import { loadStoredPreferences } from "../../../shared/prefs.js";
import { t } from "../../../shared/i18n.js";
import { createProgressNotification, dismissProgressNotification, getSelectedVisibleMagnetUrls, getSelectedVisibleTorrentRows, getTitleFromRow, getVisibleTorrentDataRows, isNyaaTorrentDataRow, isTorrentRowHidden, removeLegacyTorrentListActionColumns, sanitizeFilename, sendAllVisibleTorrents, sendSelectedTorrents, setProgressNotificationStatus, showKeywordMonitorPopup, showKeywordSelectPopup, showNotification, showQuickFilterPopup, updateAllTorrentListLinkActions } from "../../internal.js";

const DOWNLOAD_REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_BATCH_DELAY_MS = 500;
let activeDownloadBatch = null;
let selectionChangeListenerBound = false;

function updateSelectionFromCheckboxChange(event) {
  if (!event.target?.classList?.contains("magnet-checkbox")) return;
  const counter = document.querySelector(".magnet-selection-counter");
  updateSelectionCounterDisplay(counter, countVisibleCheckedTorrents());
}

function ensureSelectionChangeListener() {
  if (selectionChangeListenerBound) return;
  document.addEventListener("change", updateSelectionFromCheckboxChange);
  selectionChangeListenerBound = true;
}

function createCancelableDownloadProgress() {
  const element = createProgressNotification();
  element.classList.add("ne-download-progress");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  const status = document.createElement("span");
  status.className = "ne-download-progress__status";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ne-download-progress__cancel";
  cancel.textContent = t("Cancel download");
  cancel.setAttribute("aria-label", t("Cancel download"));
  element.append(status, cancel);
  return { element, status, cancel };
}

function setDownloadProgress(progress, message) {
  progress.status.textContent = message;
}

function waitForDownloadBatchDelay(batch) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, DOWNLOAD_BATCH_DELAY_MS);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      batch.controller.signal.removeEventListener("abort", onAbort);
      resolve();
    }
    batch.controller.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchDownloadBlobWithTimeout(url, batch) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  batch.controller.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DOWNLOAD_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.blob();
  } catch (error) {
    if (timedOut) error.downloadTimedOut = true;
    throw error;
  } finally {
    clearTimeout(timeout);
    batch.controller.signal.removeEventListener("abort", abort);
  }
}

function finishDownloadProgress(progress, kind, message) {
  setProgressNotificationStatus(progress.element, kind);
  progress.cancel.disabled = true;
  setDownloadProgress(progress, message);
  dismissProgressNotification(progress.element);
}

export async function addCopyButton() {
  const prefs = await loadStoredPreferences();

  // If buttons are disabled, don't add the button container
  if (!prefs.showButtons) return;
  if (document.querySelector(".button-container.nyaa-enhancer-toolbar")) return;

  const container = document.querySelector(".table-responsive");
  if (!container) return;

  // Create a container for all our buttons and controls
  // This will be placed above the torrent table
  const buttonContainer = document.createElement("div");
  buttonContainer.className = "button-container nyaa-enhancer-toolbar";

  const toolbarMain = document.createElement("div");
  toolbarMain.className = "nyaa-enhancer-toolbar__main";

  const copyGroup = document.createElement("div");
  copyGroup.className =
    "nyaa-enhancer-toolbar__group nyaa-enhancer-toolbar__group--split";
  copyGroup.dataset.group = "copy";

  const downloadGroup = document.createElement("div");
  downloadGroup.className =
    "nyaa-enhancer-toolbar__group nyaa-enhancer-toolbar__group--split";
  downloadGroup.dataset.group = "download";

  const sendGroup = document.createElement("div");
  sendGroup.className =
    "nyaa-enhancer-toolbar__group nyaa-enhancer-toolbar__group--split";
  sendGroup.dataset.group = "send";

  const sendSelectedButton = document.createElement("button");
  sendSelectedButton.className = "copy-magnets-button send-batch-button";
  sendSelectedButton.type = "button";
  sendSelectedButton.title = t("Send Selected");
  sendSelectedButton.setAttribute("aria-label", t("Send Selected"));
  sendSelectedButton.innerHTML =
    `<i class="fa fa-cloud-upload" aria-hidden="true"></i><span class="ne-btn-label">${t("Send")}</span>`;
  sendSelectedButton.addEventListener("click", sendSelectedTorrents);

  const sendAllButton = document.createElement("button");
  sendAllButton.className = "copy-magnets-button send-batch-button";
  sendAllButton.type = "button";
  sendAllButton.title = t("Send All");
  sendAllButton.setAttribute("aria-label", t("Send All"));
  sendAllButton.innerHTML =
    `<i class="fa fa-paper-plane ne-btn-icon-compact" aria-hidden="true"></i><span class="ne-btn-label">${t("All")}</span>`;
  sendAllButton.addEventListener("click", sendAllVisibleTorrents);
  if (!prefs.showSendButtons) {
    sendGroup.classList.add("nyaa-enhancer-toolbar__btn--hidden");
  }

  const selectionGroup = document.createElement("div");
  selectionGroup.className = "nyaa-enhancer-toolbar__group";
  selectionGroup.dataset.group = "selection";

  const toolbarAside = document.createElement("div");
  toolbarAside.className = "nyaa-enhancer-toolbar__aside";

  // Create the "Copy Selected" button
  // This copies magnet links of checked items
  const copyButton = document.createElement("button");
  copyButton.className = "copy-magnets-button";
  copyButton.type = "button";
  copyButton.title = t("Copy Selected");
  copyButton.setAttribute("aria-label", t("Copy Selected"));
  copyButton.innerHTML =
    `<i class="fa fa-copy" aria-hidden="true"></i><span class="ne-btn-label">${t("Copy")}</span>`;
  copyButton.addEventListener("click", copySelectedMagnets);

  // Create the "Copy All" button
  // This copies all magnet links regardless of selection
  const copyAllButton = document.createElement("button");
  copyAllButton.className = "copy-magnets-button";
  copyAllButton.type = "button";
  copyAllButton.title = t("Copy All");
  copyAllButton.setAttribute("aria-label", t("Copy All"));
  copyAllButton.innerHTML =
    `<i class="fa fa-files-o ne-btn-icon-compact" aria-hidden="true"></i><span class="ne-btn-label">${t("All")}</span>`;
  copyAllButton.addEventListener("click", copyAllMagnets);

  // Create the "Download Selected" button
  // This downloads .torrent files for checked items
  const downloadButton = document.createElement("button");
  downloadButton.className = "copy-magnets-button download-button";
  downloadButton.type = "button";
  downloadButton.title = t("Download Selected");
  downloadButton.setAttribute("aria-label", t("Download Selected"));
  downloadButton.innerHTML =
    `<i class="fa fa-download" aria-hidden="true"></i><span class="ne-btn-label">${t("Download")}</span>`;
  downloadButton.addEventListener("click", downloadSelectedTorrents);

  // Create the "Download All" button
  // This downloads all .torrent files on the page
  const downloadAllButton = document.createElement("button");
  downloadAllButton.className = "copy-magnets-button download-button";
  downloadAllButton.type = "button";
  downloadAllButton.title = t("Download All");
  downloadAllButton.setAttribute("aria-label", t("Download All"));
  downloadAllButton.innerHTML =
    `<i class="fa fa-cloud-download ne-btn-icon-compact" aria-hidden="true"></i><span class="ne-btn-label">${t("All")}</span>`;
  downloadAllButton.addEventListener("click", downloadAllTorrents);

  const invertButton = document.createElement("button");
  invertButton.className = "copy-magnets-button";
  invertButton.type = "button";
  invertButton.title = t("Invert Selection");
  invertButton.setAttribute("aria-label", t("Invert Selection"));
  invertButton.innerHTML =
    `<i class="fa fa-exchange" aria-hidden="true"></i><span class="ne-btn-label">${t("Invert")}</span>`;
  invertButton.addEventListener("click", invertSelection);

  // Create the "Clear Selection" button
  // This unchecks all checkboxes
  const clearButton = document.createElement("button");
  clearButton.className = "copy-magnets-button clear-button";
  clearButton.type = "button";
  clearButton.title = t("Clear Selection");
  clearButton.setAttribute("aria-label", t("Clear Selection"));
  clearButton.innerHTML =
    `<i class="fa fa-times-circle" aria-hidden="true"></i><span class="ne-btn-label">${t("Clear")}</span>`;
  clearButton.addEventListener("click", clearSelection);

  // Create a counter to show how many items are selected
  const selectionCounter = document.createElement("span");
  selectionCounter.className = "magnet-selection-counter";
  selectionCounter.setAttribute("role", "status");
  selectionCounter.setAttribute("aria-live", "polite");
  updateSelectionCounterDisplay(selectionCounter, 0);
  ensureSelectionChangeListener();

  // Create Quick Filter button
  const quickFilterButton = document.createElement("button");
  quickFilterButton.className = "copy-magnets-button quick-filter-button";
  quickFilterButton.type = "button";
  quickFilterButton.title = t("Quick Search");
  quickFilterButton.setAttribute("aria-label", t("Quick Search"));
  if (!prefs.showQuickFilter) {
    quickFilterButton.classList.add("nyaa-enhancer-toolbar__btn--hidden");
  }
  quickFilterButton.innerHTML =
    `<i class="fa fa-bolt" aria-hidden="true"></i><span class="ne-btn-label">${t("Quick Search")}</span>`;
  quickFilterButton.addEventListener("click", showQuickFilterPopup);

  // Create Keyword Select button
  const keywordSelectButton = document.createElement("button");
  keywordSelectButton.className = "copy-magnets-button keyword-select-button";
  keywordSelectButton.type = "button";
  keywordSelectButton.title = t("Keyword Select");
  keywordSelectButton.setAttribute("aria-label", t("Keyword Select"));
  keywordSelectButton.innerHTML =
    `<i class="fa fa-check-square" aria-hidden="true"></i><span class="ne-btn-label">${t("Keywords")}</span>`;
  keywordSelectButton.addEventListener("click", showKeywordSelectPopup);

  // Create Keyword Monitor button
  const keywordMonitorButton = document.createElement("button");
  keywordMonitorButton.className = "copy-magnets-button keyword-monitor-button";
  keywordMonitorButton.type = "button";
  keywordMonitorButton.title = t("Keyword Monitor");
  keywordMonitorButton.setAttribute("aria-label", t("Keyword Monitor"));
  if (!prefs.showMonitorButtons) {
    keywordMonitorButton.classList.add("nyaa-enhancer-toolbar__btn--hidden");
  }
  keywordMonitorButton.innerHTML =
    `<i class="fa fa-bell" aria-hidden="true"></i><span class="ne-btn-label">${t("Monitor")}</span>`;
  keywordMonitorButton.addEventListener("click", showKeywordMonitorPopup);

  copyGroup.append(copyButton, copyAllButton);
  downloadGroup.append(downloadButton, downloadAllButton);
  sendGroup.append(sendSelectedButton, sendAllButton);
  selectionGroup.append(
    invertButton,
    keywordSelectButton,
    keywordMonitorButton,
    clearButton,
  );
  toolbarMain.append(copyGroup, downloadGroup, sendGroup, selectionGroup);
  toolbarAside.append(selectionCounter, quickFilterButton);
  buttonContainer.append(toolbarMain, toolbarAside);
  container.parentNode.insertBefore(buttonContainer, container);
}

export function updateSelectionCounterDisplay(counter, count) {
  if (counter) {
    counter.textContent = t("{count} selected", { count });
    counter.classList.toggle("magnet-selection-counter--active", count > 0);
  }
  syncSelectAllCheckbox();
}

export function getVisibleRowCheckboxes() {
  return getVisibleTorrentDataRows()
    .map((row) => row.querySelector(".magnet-checkbox"))
    .filter(Boolean);
}

export function countVisibleCheckedTorrents() {
  return getVisibleRowCheckboxes().filter((box) => box.checked).length;
}

export function syncSelectionToVisibleRows() {
  document.querySelectorAll("table.torrent-list tbody tr").forEach((row) => {
    if (!isTorrentRowHidden(row)) return;
    const checkbox = row.querySelector(".magnet-checkbox");
    if (checkbox?.checked) checkbox.checked = false;
  });
  const counter = document.querySelector(".magnet-selection-counter");
  updateSelectionCounterDisplay(counter, countVisibleCheckedTorrents());
}

export function syncSelectAllCheckbox() {
  const header = document.querySelector(".magnet-select-all");
  if (!header) return;
  const boxes = getVisibleRowCheckboxes();
  const checked = boxes.filter((box) => box.checked).length;
  header.checked = boxes.length > 0 && checked === boxes.length;
  header.indeterminate = checked > 0 && checked < boxes.length;
  header.disabled = boxes.length === 0;
  header.setAttribute(
    "aria-label",
    header.checked ? t("Deselect all visible torrents") : t("Select all visible torrents"),
  );
}

export function setVisibleTorrentSelection(checked) {
  getVisibleRowCheckboxes().forEach((box) => {
    box.checked = !!checked;
  });
  const selectionCounter = document.querySelector(".magnet-selection-counter");
  updateSelectionCounterDisplay(selectionCounter, countVisibleCheckedTorrents());
}

export let neTorrentCheckboxLastChecked = null;

export function addCheckboxToTorrentRow(row, prefs) {
  if (!prefs.showButtons || !isNyaaTorrentDataRow(row)) return;
  if (row.querySelector(".magnet-checkbox")) return;

  const checkboxCell = document.createElement("td");
  checkboxCell.className = "text-center";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "magnet-checkbox";

  checkbox.addEventListener("click", function (e) {
    if (!neTorrentCheckboxLastChecked) {
      neTorrentCheckboxLastChecked = this;
      return;
    }

    if (e.shiftKey) {
      const checkboxes = Array.from(
        document.querySelectorAll(".magnet-checkbox"),
      ).filter((box) => !isTorrentRowHidden(box.closest("tr")));
      const start = checkboxes.indexOf(this);
      const end = checkboxes.indexOf(neTorrentCheckboxLastChecked);
      if (start !== -1 && end !== -1) {
        checkboxes
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .forEach((box) => (box.checked = this.checked));
      }
    }

    neTorrentCheckboxLastChecked = this;
  });

  checkboxCell.appendChild(checkbox);
  row.appendChild(checkboxCell);
}

// Function to add a checkbox column to the torrent table
// This allows users to select individual torrents for batch operations
export async function addCheckboxColumn() {
  const prefs = await loadStoredPreferences();

  removeLegacyTorrentListActionColumns();
  await updateAllTorrentListLinkActions(prefs);

  // Add checkbox column header only if buttons are enabled and doesn't exist
  const headerRow = document.querySelector("table.torrent-list thead tr");
  if (
    headerRow &&
    prefs.showButtons &&
    !headerRow.querySelector(".magnet-checkbox-column")
  ) {
    const checkboxHeader = document.createElement("th");
    checkboxHeader.className = "magnet-checkbox-column text-center";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.className = "magnet-select-all";
    selectAll.title = t("Select all visible");
    selectAll.setAttribute("aria-label", t("Select all visible torrents"));
    selectAll.addEventListener("click", (event) => {
      event.stopPropagation();
      setVisibleTorrentSelection(selectAll.checked);
    });
    checkboxHeader.appendChild(selectAll);
    headerRow.appendChild(checkboxHeader);
  }

  document.querySelectorAll("table.torrent-list tbody tr").forEach((row) => {
    addCheckboxToTorrentRow(row, prefs);
  });
  syncSelectAllCheckbox();
}

export async function enhanceTorrentTable() {
  await addCopyButton();
  await addCheckboxColumn();
}

export function copySelectedMagnets() {
  const selectedMagnets = getSelectedVisibleMagnetUrls();

  // If we found any magnet links, copy them to clipboard
  if (selectedMagnets.length > 0) {
    const magnetText = selectedMagnets.join("\n"); // One link per line
    navigator.clipboard
      .writeText(magnetText)
      .then(() => {
        showNotification(
          t("{count} Magnet links copied to clipboard!", { count: selectedMagnets.length }),
          true,
        );
      })
      .catch((err) => {
        console.error("Failed to copy magnets:", err);
        showNotification(t("Failed to copy magnet links"), false);
      });
  } else {
    showNotification(t("No visible torrents selected!"), false);
  }
}

// Function to copy ALL magnet links from the page
// This ignores the checkbox selection state
export function copyAllMagnets() {
  const allMagnets = [];
  const rows = document.querySelectorAll("table.torrent-list tbody tr");

  // Loop through all visible rows and collect magnet links
  rows.forEach((row) => {
    // Skip hidden rows (dead torrents)
    if (row.style.display === "none") return;

    const magnetLink = row.querySelector('a[href^="magnet:"]');
    if (magnetLink) {
      allMagnets.push(magnetLink.href);
    }
  });

  // If we found any magnet links, copy them to clipboard
  if (allMagnets.length > 0) {
    const magnetText = allMagnets.join("\n"); // One link per line
    navigator.clipboard
      .writeText(magnetText)
      .then(() => {
        showNotification(
          t("Copied {count} magnet links to clipboard!", { count: allMagnets.length }),
          true,
        );
      })
      .catch((err) => {
        console.error("Failed to copy magnets:", err);
        showNotification(t("Failed to copy magnet links"), false);
      });
  } else {
    showNotification(t("No magnet links found!"), false);
  }
}

// Function to update the selection counter display
// Shows how many torrents are currently selected
export function updateSelectionCounter(selectionCounter) {
  updateSelectionCounterDisplay(
    selectionCounter,
    countVisibleCheckedTorrents(),
  );
}

// Function to clear all selected checkboxes
// Shows a notification if there's nothing to clear
export function clearSelection() {
  const checkboxes = document.querySelectorAll(".magnet-checkbox:checked");
  if (checkboxes.length === 0) {
    showNotification(t("No checkboxes are selected to clear!"), false);
    return;
  }

  const selectionCounter = document.querySelector(".magnet-selection-counter");
  if (!selectionCounter) return;

  // Uncheck all selected checkboxes
  checkboxes.forEach((checkbox) => {
    checkbox.checked = false;
  });

  // Reset the selection counter
  updateSelectionCounterDisplay(selectionCounter, 0);
  showNotification(t("Selection cleared"), true);
}

export async function downloadSelectedTorrents() {
  const selectedTorrents = [];
  getSelectedVisibleTorrentRows().forEach((row) => {
    const torrentLink = row.querySelector('a[href$=".torrent"]');
    const title = getTitleFromRow(row);
    if (torrentLink && title) {
      selectedTorrents.push({
        url: torrentLink.href,
        filename: title,
      });
    }
  });

  // Start download process if we found any torrents
  if (selectedTorrents.length > 0) {
    await downloadTorrents(selectedTorrents, "selected_torrents.zip");
  } else {
    showNotification(t("No visible torrents selected!"), false);
  }
}

// Function to download all torrent files on the page
// Downloads are combined into a ZIP if the ZIP option is enabled
export async function downloadAllTorrents() {
  const allTorrents = [];
  const rows = document.querySelectorAll("table.torrent-list tbody tr");

  // Collect information about all visible torrents
  rows.forEach((row) => {
    // Skip hidden rows (dead torrents)
    if (row.style.display === "none") return;

    const torrentLink = row.querySelector('a[href$=".torrent"]');
    const title = getTitleFromRow(row);
    if (torrentLink && title) {
      allTorrents.push({
        url: torrentLink.href,
        filename: title,
      });
    }
  });

  // Start download process if we found any torrents
  if (allTorrents.length > 0) {
    await downloadTorrents(allTorrents, "all_torrents.zip");
  } else {
    showNotification(t("No torrents found!"), false);
  }
}

export async function downloadTorrentsAsZip(torrents, zipName, batch) {
  const progress = createCancelableDownloadProgress();
  const { element: progressNotification } = progress;
  progress.cancel.addEventListener("click", () => batch.controller.abort());
  try {
    const zip = new globalThis.JSZip();
    let completedDownloads = 0;
    const failedNames = [];
    const prefs = await loadStoredPreferences();

    setDownloadProgress(progress, t("Progress: {completed}/{total} files", { completed: 0, total: torrents.length }));

    const blobToBase64 = (blob) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    for (const torrent of torrents) {
      if (batch.controller.signal.aborted) break;
      try {
        if (completedDownloads > 0) {
          await waitForDownloadBatchDelay(batch);
        }
        if (batch.controller.signal.aborted) break;

        const blob = await fetchDownloadBlobWithTimeout(torrent.url, batch);
        if (batch.controller.signal.aborted) break;
        const base64Data = await blobToBase64(blob);

        const filename = prefs.useDisplayName
          ? sanitizeFilename(torrent.filename) + ".torrent"
          : torrent.url.split("/").pop();

        zip.file(filename, base64Data.split(",")[1], { base64: true });

        completedDownloads++;
        setDownloadProgress(progress, t("Progress: {completed}/{total} files", { completed: completedDownloads, total: torrents.length }));
      } catch (error) {
        if (batch.controller.signal.aborted) break;
        failedNames.push(torrent.filename);
        if (error.downloadTimedOut) showNotification(t("Timed out downloading {filename}", { filename: torrent.filename }), false);
        console.error(`Failed to fetch torrent: ${torrent.filename}`, error);
      }
    }

    if (batch.controller.signal.aborted) {
      finishDownloadProgress(progress, "warning", t("ZIP download cancelled. No ZIP file was saved."));
      return;
    }

    if (completedDownloads === 0) {
      finishDownloadProgress(progress, "error", t("ZIP failed: none of the torrent files could be downloaded."));
      return;
    }

    setDownloadProgress(progress, t("Generating ZIP file..."));

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 5 },
    }, () => {
      if (batch.controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    });

    if (batch.controller.signal.aborted) {
      finishDownloadProgress(progress, "warning", t("ZIP download cancelled. No ZIP file was saved."));
      return;
    }

    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = zipUrl;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(zipUrl);

    if (failedNames.length) {
      finishDownloadProgress(progress, "warning", t("ZIP downloaded with {failed} failed file{suffix} ({completed}/{total} ok).", { failed: failedNames.length, suffix: failedNames.length === 1 ? "" : "s", completed: completedDownloads, total: torrents.length }));
    } else {
      finishDownloadProgress(progress, "success", t("ZIP file download complete!"));
    }
  } catch (error) {
    if (batch.controller.signal.aborted || error?.name === "AbortError") {
      finishDownloadProgress(progress, "warning", t("ZIP download cancelled. No ZIP file was saved."));
      return;
    }
    console.error("Download failed:", error);
    finishDownloadProgress(progress, "error", t("Failed to create ZIP file: {message}", { message: error.message }));
  }
}

// Function to download individual torrent files one at a time
// This is used when ZIP option is disabled or only one file is selected
// torrents: Array of torrent objects with url and filename
export async function downloadIndividualTorrents(torrents, batch) {
  const prefs = await loadStoredPreferences();
  const progress = createCancelableDownloadProgress();
  const { element: progressNotification } = progress;
  progress.cancel.addEventListener("click", () => batch.controller.abort());
  let completedDownloads = 0;
  const failedNames = [];

  setDownloadProgress(progress, t("Progress: {completed}/{total} files", { completed: 0, total: torrents.length }));

  for (const torrent of torrents) {
    if (batch.controller.signal.aborted) break;
    try {
      if (completedDownloads > 0) await waitForDownloadBatchDelay(batch);
      if (batch.controller.signal.aborted) break;
      const blob = await fetchDownloadBlobWithTimeout(torrent.url, batch);
      if (batch.controller.signal.aborted) break;

      const filename = prefs.useDisplayName
        ? sanitizeFilename(torrent.filename) + ".torrent"
        : torrent.url.split("/").pop();

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(link.href);

      completedDownloads++;
      setDownloadProgress(progress, t("Progress: {completed}/{total} files", { completed: completedDownloads, total: torrents.length }));
    } catch (error) {
      if (batch.controller.signal.aborted) break;
      failedNames.push(torrent.filename);
      if (error.downloadTimedOut) showNotification(t("Timed out downloading {filename}", { filename: torrent.filename }), false);
      console.error(`Failed to download torrent: ${torrent.filename}`, error);
    }
  }

  if (batch.controller.signal.aborted) {
    finishDownloadProgress(progress, "warning", t("Download cancelled. Already downloaded files were kept."));
    return;
  }

  if (completedDownloads === 0) {
    setProgressNotificationStatus(progressNotification, "error");
    setDownloadProgress(progress, t("Download failed: none of the torrent files could be downloaded."));
  } else if (failedNames.length) {
    setProgressNotificationStatus(progressNotification, "warning");
    setDownloadProgress(progress, t("Downloaded {completed}/{total} files ({failed} failed).", { completed: completedDownloads, total: torrents.length, failed: failedNames.length }));
  } else {
    setDownloadProgress(progress, t("Download complete!"));
  }
  progress.cancel.disabled = true;
  dismissProgressNotification(progressNotification);
}

// Main download function that handles both individual and ZIP downloads
// torrents: Array of torrent objects to download
// zipName: Name to use for ZIP file if ZIP option is enabled
export async function downloadTorrents(torrents, zipName) {
  if (activeDownloadBatch) return;
  const batch = { controller: new AbortController() };
  activeDownloadBatch = batch;
  try {
    const prefs = await loadStoredPreferences();
    if (torrents.length === 1 || !prefs.useZip) await downloadIndividualTorrents(torrents, batch);
    else await downloadTorrentsAsZip(torrents, zipName, batch);
  } catch (error) {
    console.error("Unable to start download batch:", error);
    showNotification(t("Failed to start download: {message}", { message: error.message }), false);
  } finally {
    if (activeDownloadBatch === batch) activeDownloadBatch = null;
  }
}

export function invertSelection() {
  const checkboxes = document.querySelectorAll(".magnet-checkbox");
  let invertedCount = 0;

  checkboxes.forEach((checkbox) => {
    // Only invert selection for visible rows
    const row = checkbox.closest("tr");
    if (row && row.style.display !== "none") {
      checkbox.checked = !checkbox.checked;
      if (checkbox.checked) invertedCount++;
    }
  });

  const selectionCounter = document.querySelector(".magnet-selection-counter");
  updateSelectionCounterDisplay(
    selectionCounter,
    countVisibleCheckedTorrents(),
  );

  showNotification(
    t("Selection inverted ({count} items selected)", { count: invertedCount }),
    true,
  );
}
