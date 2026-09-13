// Synthetic verification data only. It never represents, fetches, or links to Nyaa content.
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../../src/chrome/manifest.json", import.meta.url), "utf8"));
const escape = (value) => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
export const PREVIEW_PORT = 4173;

const oneDay = 86_400;
const ids = new Map([
  ["recent", 1], ["week", 2], ["month", 3], ["old", 4], ["future", 5],
  ["duplicate", 1], ["page-two", 6], ["page-three", 7], ["too-old", 8],
]);

function row(name, ageDays, now, { future = false } = {}) {
  const id = ids.get(name) ?? (100 + Number(name.match(/\d+$/)?.[0] || 0));
  const timestamp = now + (future ? oneDay : -ageDays * oneDay);
  const hash = String(id).padStart(40, "0");
  const size = name === "month" ? "500 MiB" : "1.0 GiB";
  const seeders = name === "month" ? 25 : name === "recent" || name === "duplicate" ? 20 : name === "week" ? 10 : 9;
  const titles = ["【検証用】星の図書館と旅する記録係 第01-08巻 [Hoshi no Toshokan vol 01-08]", "【検証用】小さな町のものづくり日誌 第12巻", "【検証用】空想世界の探検家たちと長い名前の資料集 第01-21巻 [Imaginary Explorers and the Archive vol 01-21]", "【検証用】月刊サンプル通信 2026年09月号", "【検証用】はじめての日本語読書ノート 第01-03巻"];
  const title = `${titles[(id - 1) % titles.length]} · ${name}`;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `<tr data-fixture-row="${name}">
    <td class="text-center"><a href="/?c=3_3" title="Literature - Raw"><span class="category-icon fixture-category">本</span></a></td>
    <td colspan="2"><a href="/view/${id}" title="${escape(title)}">${escape(title)}</a></td>
    <td class="text-center"><a href="/download/${id}.torrent" aria-label="Synthetic torrent"><i class="fa fa-fw fa-download"></i></a><a href="magnet:?xt=urn:btih:${hash}" aria-label="Synthetic magnet"><i class="fa fa-fw fa-magnet"></i></a></td>
    <td class="text-center">${size}</td><td class="text-center" data-timestamp="${timestamp}">${date}</td>
    <td class="text-center">${seeders}</td><td class="text-center">2</td><td class="text-center">8</td>
  </tr>`;
}

function rowsFor(page, mode, now) {
  if (mode === "visual" && page === 1) return Array.from({ length: 60 }, (_, index) => row(`visual-${index + 1}`, 0.2 + index / 10, now));
  if (page === 1) return [row("month", 20, now), row("recent", 0.25, now), row("week", 3, now), row("old", 45, now), row("future", 0, now, { future: true })];
  if (mode === "skip") {
    if (page === 2) return [row("duplicate", 0.25, now), row("too-old", 60, now)];
    if (page === 3) return [row("page-three", 2, now)];
    return [];
  }
  if (mode === "empty" && page === 2) return [];
  if (mode === "limit" && page > 1) return [row(`limit-${page}`, 60, now)];
  if (page === 2) return [row("duplicate", 0.25, now), row("page-two", 2, now), row("too-old", 60, now)];
  return [];
}

export function fixtureHtml(input = `http://127.0.0.1:${PREVIEW_PORT}/`, { preview = true } = {}) {
  const url = new URL(input);
  const page = Math.max(1, Number(url.searchParams.get("p")) || 1);
  const mode = url.searchParams.get("fixture") || "normal";
  const now = Math.floor(Date.now() / 1000);
  const hasNext = mode === "skip" ? page < 3 : mode === "limit" ? page < 13 : page < 2;
  const next = new URL(url);
  next.searchParams.set("p", String(page + 1));
  const assets = "/tests/fixtures/site-assets";
  const category = url.searchParams.get("c") || "0_0";
  const categories = [["0_0", "All categories"], ["1_2", "Anime - English"], ["3_3", "Literature - Raw"]];
  const options = categories.map(([value, label]) => `<option value="${value}" ${category === value ? "selected" : ""}>${label}</option>`).join("");
  const themeScript = `<script>document.getElementById('theme-toggle').onclick=()=>{const dark=document.body.classList.toggle('dark');document.getElementById('bsThemeLink').href='${assets}/css/bootstrap'+(dark?'-dark':'')+'.min.css';};</script>`;
  const extensionStyles = preview ? manifest.content_scripts.flatMap((entry) => entry.css || []).map((path) => `<link rel="stylesheet" href="/src/chrome/${path}">`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Nyaa verification fixture</title>
  <link rel="stylesheet" id="bsThemeLink" href="${assets}/css/bootstrap.min.css"><link rel="stylesheet" href="${assets}/css/bootstrap-xl-mod.css"><link rel="stylesheet" href="${assets}/css/font-awesome.min.css"><link rel="stylesheet" href="${assets}/css/main.css">
  <style>
  .fixture-search{display:flex;align-items:center;gap:0;margin:8px 0 8px auto;padding:0;max-width:100%}.fixture-search .form-control{width:120px;border-radius:0}.fixture-search [name=c]{width:130px}.fixture-search [name=q]{width:198px}.fixture-search .btn{border-radius:0 4px 4px 0}
  .fixture-category{display:inline-block;background:#357653;border:1px solid #246343;border-radius:3px;color:white;text-align:right;font:bold 23px/26px sans-serif;padding-right:10px}.fixture-disclosure{color:#777;font-size:12px;margin:12px 0}.fixture-tools{display:flex;justify-content:center;gap:12px;align-items:center;flex-wrap:wrap}.fixture-tools button{border:0;background:none;color:#337ab7;padding:0}
  @media(min-width:992px){#navbar{display:flex!important;align-items:center}.fixture-guest{padding:15px 0 15px 25px;color:#999;white-space:nowrap}}
  @media(max-width:991px){.fixture-search{flex-wrap:wrap;margin:10px 0}.fixture-search [name=q]{flex:1;min-width:80px}.fixture-guest{display:none}.fixture-search .form-control{margin:0}.navbar-header{float:none}.navbar-nav{display:none}#navbar{padding-bottom:10px}}
  </style>${extensionStyles}</head>
  <body><nav class="navbar navbar-default navbar-static-top navbar-inverse"><div class="container"><div class="navbar-header"><a class="navbar-brand" href="/">Nyaa</a></div><div id="navbar"><ul class="nav navbar-nav"><li><a href="#">Upload</a></li><li><a href="#">Info <span class="caret"></span></a></li><li><a id="rss-link" href="/?page=rss">RSS</a></li><li><a href="/changelog">Changelog</a></li><li><a href="/settings">Settings</a></li></ul>
  <form class="navbar-form fixture-search" method="get" action="/"><select class="form-control" name="f" aria-label="Filter"><option value="0">No filter</option><option value="1" ${url.searchParams.get("f") === "1" ? "selected" : ""}>No remakes</option></select><select class="form-control" name="c" aria-label="Category">${options}</select><input class="form-control" name="q" placeholder="Search..." aria-label="Search" value="${escape(url.searchParams.get("q") || "")}"><button class="btn btn-primary" type="submit" aria-label="Native search"><i class="fa fa-search fa-fw"></i></button></form><span class="fixture-guest"><i class="fa fa-user"></i> Guest <span class="caret"></span></span></div></div></nav>
  <main class="container">
  <div class="table-responsive"><table class="table table-striped table-bordered table-hover torrent-list"><thead><tr><th class="hdr-category text-center" style="width:80px">Category</th><th class="hdr-name">Name</th><th class="hdr-comments sorting" style="width:50px"><i class="fa fa-comments-o"></i></th><th class="hdr-link text-center" style="width:100px">Link</th><th class="hdr-size text-center sorting" style="width:100px">Size</th><th class="hdr-date text-center sorting" style="width:140px">Date<a id="sort-link" href="/?s=id&o=asc" aria-label="Sort by date"></a></th><th class="hdr-seeders text-center sorting_desc" style="width:50px"><i class="fa fa-arrow-up" title="Seeders"></i></th><th class="hdr-leechers text-center sorting" style="width:50px"><i class="fa fa-arrow-down" title="Leechers"></i></th><th class="hdr-downloads text-center sorting" style="width:60px"><i class="fa fa-check" title="Completed downloads"></i></th></tr></thead><tbody>${rowsFor(page, mode, now).join("")}</tbody></table></div>
  <div class="text-center"><ul class="pagination"><li class="active"><a href="${escape(url.href)}">${page}</a></li>${hasNext ? `<li><a rel="next" href="${escape(next.pathname + next.search)}">Next</a></li>` : ""}</ul></div>
  <footer class="text-center"><div class="fixture-tools"><span>Dark Mode: <button id="theme-toggle" type="button">Toggle</button></span><a id="detail-link" href="/view/999">Synthetic detail</a></div><p class="fixture-disclosure">LOCAL TEST FIXTURE · 架空の検証データです。実サイトへの接続・ダウンロードはありません。</p></footer></main>
  ${themeScript}${preview ? `<script src="/tests/fixtures/preview-stub.js"></script><script type="module">import '/src/chrome/content/index.js';</script>` : ""}</body></html>`;
}
