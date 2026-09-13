// Local-only synthetic preview for manual verification. It intentionally has no external proxying.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, isAbsolute } from "node:path";
import { PREVIEW_PORT, fixtureHtml } from "../tests/fixtures/nyaa-fixture.mjs";

const host = "127.0.0.1";
const root = resolve(process.cwd());
const mime = { ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${PREVIEW_PORT}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml(url.href));
    return;
  }
  if (url.pathname === "/tests/fixtures/preview-stub.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(await readFile(join(root, "tests", "fixtures", "preview-stub.js")));
    return;
  }
  const prefix = ["/src/chrome/", "/tests/fixtures/site-assets/"].find((path) => url.pathname.startsWith(path));
  if (!prefix) { response.writeHead(404).end("Synthetic fixture path not found"); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400).end(); return; }
  const allowedRoot = resolve(root, `.${prefix}`);
  const candidate = resolve(root, `.${pathname}`);
  const inside = relative(allowedRoot, candidate);
  if (inside.startsWith("..") || isAbsolute(inside)) { response.writeHead(403).end(); return; }
  try {
    response.writeHead(200, { "content-type": `${mime[extname(candidate)] || "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store" });
    response.end(await readFile(candidate));
  } catch { response.writeHead(404).end(); }
});
server.listen(PREVIEW_PORT, host, () => console.log(`Synthetic fixture preview: http://${host}:${PREVIEW_PORT}/?s=seeders&o=desc`));
