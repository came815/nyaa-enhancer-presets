import { dispatchTableMutated } from "./registry.js";

export let neTableMutationObserver = null;
let observerPauseDepth = 0;
let pendingTableMutations = [];
let dispatchScheduled = false;
let dispatchInProgress = false;
const ENHANCEMENT_SELECTOR = [
  ".magnet-checkbox",
  ".magnet-checkbox-column",
  ".link-action-copy",
  ".link-action-send",
  ".link-action-at",
  ".torrent-link-actions",
  ".seadex-link",
].join(", ");

function nodeContainsTorrentTable(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return node.matches("table.torrent-list") || !!node.querySelector("table.torrent-list");
}

function nodeContainsTorrentRows(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return node.matches("tr") || !!node.querySelector("tr");
}

function isWhitespaceTextNode(node) {
  return node.nodeType === Node.TEXT_NODE && /^\s*$/.test(node.textContent);
}

function isEnhancementNode(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return false;
  return (
    element.matches(ENHANCEMENT_SELECTOR) ||
    !!element.closest(ENHANCEMENT_SELECTOR) ||
    (
      element.matches("td") &&
      element.children.length === 1 &&
      element.firstElementChild?.matches(".magnet-checkbox")
    )
  );
}

function isExtensionOnlyMutation(mutation) {
  if (mutation.type === "characterData") return isEnhancementNode(mutation.target);
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every((node) =>
    !nodeContainsTorrentRows(node) &&
    (isWhitespaceTextNode(node) || isEnhancementNode(node)),
  );
}

function mutationAffectsTorrentTable(mutation) {
  const target = mutation.target;
  const targetElement = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  const targetTable = targetElement
    ? targetElement.closest("table.torrent-list")
    : null;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];

  if (!targetTable) {
    return nodes.some(nodeContainsTorrentTable);
  }

  if (isExtensionOnlyMutation(mutation)) return false;
  if (mutation.type === "characterData") return true;

  if (targetElement.matches("tbody") || targetElement.matches("table.torrent-list")) {
    return nodes.some((node) => nodeContainsTorrentRows(node) || node.matches?.("tbody"));
  }

  if (targetElement.closest("tbody tr")) return true;
  return nodes.some(nodeContainsTorrentRows);
}

function scheduleTableMutationDispatch() {
  if (
    dispatchScheduled ||
    dispatchInProgress ||
    observerPauseDepth > 0 ||
    !pendingTableMutations.length
  ) {
    return;
  }
  dispatchScheduled = true;
  queueMicrotask(async () => {
    dispatchScheduled = false;
    if (dispatchInProgress || observerPauseDepth > 0 || !pendingTableMutations.length) return;

    dispatchInProgress = true;
    const mutations = pendingTableMutations;
    pendingTableMutations = [];
    try {
      await dispatchTableMutated(mutations);
    } catch (error) {
      // Registry hooks are isolated, but keep the observer alive if a future
      // dispatcher implementation rejects unexpectedly.
      console.error("[Nyaa Enhancer] table mutation dispatch failed.", error);
    } finally {
      dispatchInProgress = false;
      scheduleTableMutationDispatch();
    }
  });
}

function queueTableMutations(mutations) {
  const relevant = mutations.filter(mutationAffectsTorrentTable);
  if (!relevant.length) return;
  pendingTableMutations.push(...relevant);
  scheduleTableMutationDispatch();
}

function observeDocumentRoot() {
  if (!neTableMutationObserver || !document.documentElement) return;
  neTableMutationObserver.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

export async function withTorrentTableObserverPaused(asyncFn) {
  observerPauseDepth++;
  if (neTableMutationObserver) {
    queueTableMutations(neTableMutationObserver.takeRecords());
    neTableMutationObserver.disconnect();
  }
  try {
    return await asyncFn();
  } finally {
    observerPauseDepth--;
    if (observerPauseDepth === 0) {
      observeDocumentRoot();
      scheduleTableMutationDispatch();
    }
  }
}

export function observeTableChanges() {
  if (!document.querySelector("table.torrent-list tbody") || neTableMutationObserver) return;
  neTableMutationObserver = new MutationObserver((mutations) => {
    queueTableMutations(mutations);
  });
  observeDocumentRoot();
}
