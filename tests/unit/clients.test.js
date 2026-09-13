import assert from "node:assert/strict";
import test from "node:test";
import { FETCH_TIMEOUT_MS, handleFetchJson, handleFetchUrl, handleSendTorrent, isAllowedTextFetchUrl } from "../../src/chrome/background/fetch-proxy.js";
import { sendDeluge } from "../../src/chrome/background/torrent-clients/deluge.js";
import { NYAA_DOMAINS } from "../../src/chrome/shared/domains.js";
import { extractInfohash } from "../../src/chrome/shared/magnet.js";
import { dedupeMagnetUrls } from "../../src/chrome/content/features/send-to-client/index.js";
import { sendQbt } from "../../src/chrome/background/torrent-clients/qbittorrent.js";

const originalFetch = globalThis.fetch;

function withFetch(t, handler) {
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("text proxy only fetches its caller inventory and reports HTTP errors", async (t) => {
  const calls = [];
  withFetch(t, async (url, init) => {
    calls.push({ url, init });
    return new Response("missing", { status: 404 });
  });

  assert.deepEqual(await handleFetchUrl({ url: "file:///etc/passwd" }), {
    ok: false,
    error: "host_not_allowed",
  });
  assert.deepEqual(await handleFetchUrl({ url: "https://notamenzb.moe/api" }), {
    ok: false,
    error: "host_not_allowed",
  });
  assert.deepEqual(await handleFetchUrl({ url: "https://feed.animetosho.xyz/json" }), {
    ok: false,
    status: 404,
    text: "missing",
    error: "HTTP 404",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("text proxy preserves all configured Nyaa roots and subdomains", () => {
  for (const domain of NYAA_DOMAINS) {
    assert.equal(isAllowedTextFetchUrl(`http://${domain}/view/1`), true, domain);
    assert.equal(isAllowedTextFetchUrl(`https://sub.${domain}/view/1`), true, `sub.${domain}`);
    assert.equal(isAllowedTextFetchUrl(`https://not-${domain}/view/1`), false, `not-${domain}`);
  }
  for (const hostname of [
    "amenzb.moe",
    "api.themoviedb.org",
    "feed.animetosho.org",
    "feed.animetosho.xyz",
    "animetosho.org",
    "animetosho.xyz",
    "nekobt.to",
    "api.tsukihime.org",
    "releases.moe",
    "thexem.info",
  ]) {
    assert.equal(isAllowedTextFetchUrl(`https://${hostname}/`), true, hostname);
    assert.equal(isAllowedTextFetchUrl(`http://${hostname}/`), false, `${hostname} http`);
  }
});

test("text and JSON proxy timeouts remain active while their response body is read", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeout;
  globalThis.setTimeout = (callback, ms) => {
    assert.equal(ms, FETCH_TIMEOUT_MS);
    timeout = callback;
    return 1;
  };
  globalThis.clearTimeout = () => {};
  withFetch(t, async (_url, init) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => {
      timeout();
      if (init.signal.aborted) throw new Error("body_timeout");
      return "{}";
    },
  }));
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  assert.deepEqual(await handleFetchUrl({ url: "https://feed.animetosho.xyz/json" }), {
    ok: false,
    error: "body_timeout",
  });
  assert.deepEqual(await handleFetchJson({ url: "https://api.tenrai.org/v1/search" }), {
    ok: false,
    error: "body_timeout",
  });
});

test("infohash canonicalization collapses tracker variants, case, and base32", () => {
  const hex = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(extractInfohash(`magnet:?tr=https%3A%2F%2Fa&xt=urn%3Abtih%3A${hex.toUpperCase()}`), hex);
  assert.equal(
    extractInfohash("magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH"),
    hex,
  );
  assert.equal(
    extractInfohash(`magnet:?xt=urn:btmh:1220deadbeef&xt=urn:btih:${hex}`),
    hex,
  );
  assert.equal(
    extractInfohash(`magnet:?xt=urn:btih:not-a-hash&xt=urn:btih:${hex}`),
    hex,
  );
  assert.equal(extractInfohash("https://example.test/?xt=urn:btih:0123"), null);
  assert.deepEqual(
    dedupeMagnetUrls([
      `magnet:?tr=https%3A%2F%2Fa&xt=urn%3Abtih%3A${hex.toUpperCase()}`,
      "magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH&tr=https%3A%2F%2Fb",
    ]),
    [`magnet:?tr=https%3A%2F%2Fa&xt=urn%3Abtih%3A${hex.toUpperCase()}`],
  );
});

test("qBittorrent rejects a 200 Fails. acknowledgement", async (t) => {
  const responses = [
    new Response("Ok."),
    new Response("v5.0.0"),
    new Response("Ok."),
    new Response("[]", { headers: { "content-type": "application/json" } }),
    new Response("Fails."),
  ];
  withFetch(t, async () => responses.shift());
  assert.deepEqual(
    await sendQbt("http://client", "user", "pass", "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"),
    { ok: false, error: "request_failed" },
  );
});

test("qBittorrent accepts its successful add acknowledgement", async (t) => {
  const responses = [
    new Response("v5.0.0"),
    new Response("[]", { headers: { "content-type": "application/json" } }),
    new Response("Ok."),
  ];
  withFetch(t, async () => responses.shift());
  assert.deepEqual(
    await sendQbt("http://client", "", "", "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"),
    { ok: true },
  );
});

test("Deluge only accepts a non-empty torrent id from core.add_torrent_magnet", async (t) => {
  const addResults = [
    { id: 3, result: null, error: null },
    { id: 3, error: null },
    { id: 2, result: "torrent-id", error: null },
    { id: 3, result: "", error: null },
    { id: 3, result: "torrent-id", error: null },
  ];
  withFetch(t, async (_url, init) => {
    const { method, id } = JSON.parse(init.body);
    if (method === "auth.login") {
      return new Response(JSON.stringify({ id, result: true, error: null }));
    }
    if (method === "core.get_torrent_status") {
      return new Response(JSON.stringify({ id, result: null, error: null }));
    }
    return new Response(JSON.stringify(addResults.shift()));
  });
  const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(await sendDeluge("http://client", "pass", magnet), {
      ok: false,
      error: "request_failed",
    });
  }
  assert.deepEqual(await sendDeluge("http://client", "pass", magnet), { ok: true });
});

test("overlapping client sends share only the in-flight canonical infohash", async (t) => {
  const originalChrome = globalThis.chrome;
  let releaseInfo;
  let signalInfoRequest;
  const infoRequested = new Promise((resolve) => {
    signalInfoRequest = resolve;
  });
  const calls = [];
  let blockFirstInfo = true;
  globalThis.chrome = { permissions: { contains: async () => true } };
  withFetch(t, async (url) => {
    calls.push(url);
    if (url.endsWith("/api/v2/app/version")) return new Response("v5.0.0");
    if (url.includes("/api/v2/torrents/info?")) {
      if (blockFirstInfo) {
        blockFirstInfo = false;
        signalInfoRequest();
        await new Promise((resolve) => {
          releaseInfo = resolve;
        });
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }
    return new Response("Ok.");
  });
  t.after(() => {
    globalThis.chrome = originalChrome;
  });

  const hex = "0123456789abcdef0123456789abcdef01234567";
  const first = handleSendTorrent({
    client: "qbittorrent",
    url: "http://client",
    magnetUrl: `magnet:?xt=urn:btih:${hex}`,
  });
  await infoRequested;
  const second = handleSendTorrent({
    client: "qbittorrent",
    url: "http://client",
    magnetUrl: "magnet:?tr=https%3A%2F%2Ftracker&xt=urn%3Abtih%3AAERUKZ4JVPG66AJDIVTYTK6N54ASGRLH",
  });
  releaseInfo();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.equal(calls.length, 3, "one version check, duplicate check, and add");

  await handleSendTorrent({
    client: "qbittorrent",
    url: "http://client",
    magnetUrl: `magnet:?xt=urn:btih:${hex}`,
  });
  assert.equal(calls.length, 6, "completed sends are not retained in the in-flight map");
});
