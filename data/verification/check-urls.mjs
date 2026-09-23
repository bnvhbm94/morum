#!/usr/bin/env node
// Re-verifies every entry in data/verification/urls.json against the live web.
//
// For each URL: fetch it (10s timeout, follow redirects, browser-like User-Agent),
// strip HTML tags/entities, normalize whitespace, and assert that `excerpt` occurs
// verbatim in the resulting page text. Records `http_status`, `final_url` and
// `checked_at` (from the real fetch) on every entry it can reach. Any entry that
// fails -- non-2xx status, transport error, or the excerpt no longer found -- is
// dropped from the written file. The script always prints how many entries were
// dropped and why; it never fabricates a pass.
//
// Usage:
//   node data/verification/check-urls.mjs
//
// This overwrites data/verification/urls.json in place, keeping only entries that
// verified on this run. Run it again any time to re-check freshness (see README.md).

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const URLS_PATH = join(__dirname, "urls.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Strip tags/scripts/styles and collapse to normalized whitespace-separated text.
function htmlToNormalizedText(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  h = decodeEntities(h);
  return h.replace(/\s+/g, " ").trim();
}

function plainTextToNormalizedText(body) {
  return body.replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Some sites send a non-UTF-8 charset in the Content-Type header even when the
// in-page <meta charset> lies and claims UTF-8 (seen on kma.go.kr, EUC-KR). Decode
// from raw bytes using the HTTP-declared charset so non-Latin text doesn't come out
// as mojibake, which would make a genuinely-present excerpt fail the substring check.
async function readDeclaredCharsetText(res, contentType) {
  const m = contentType.match(/charset=([\w-]+)/i);
  const declared = (m ? m[1] : "utf-8").toLowerCase();
  if (declared === "utf-8" || declared === "utf8") return res.text();
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder(declared).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function checkOne(entry) {
  const result = { ...entry };
  let res;
  try {
    res = await fetchWithTimeout(entry.url);
  } catch (e) {
    return { ok: false, reason: "fetch_error:" + (e && e.message ? e.message : String(e)), result };
  }
  result.http_status = res.status;
  result.final_url = res.url;
  result.checked_at = new Date().toISOString();

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: "http_status_" + res.status, result };
  }

  const contentType = res.headers.get("content-type") || "";
  let normalizedText;
  try {
    if (/text\/plain/i.test(contentType)) {
      normalizedText = plainTextToNormalizedText(await readDeclaredCharsetText(res, contentType));
    } else if (/text\/html|application\/xhtml/i.test(contentType) || contentType === "") {
      normalizedText = htmlToNormalizedText(await readDeclaredCharsetText(res, contentType));
    } else {
      return { ok: false, reason: "non_html_content_type:" + contentType, result };
    }
  } catch (e) {
    return { ok: false, reason: "body_read_error:" + (e && e.message ? e.message : String(e)), result };
  }

  const normalizedExcerpt = normalizedText && entry.excerpt ? entry.excerpt.replace(/\s+/g, " ").trim() : "";
  if (!normalizedExcerpt) {
    return { ok: false, reason: "empty_excerpt", result };
  }
  if (!normalizedText.includes(normalizedExcerpt)) {
    return { ok: false, reason: "excerpt_not_found_verbatim", result };
  }

  return { ok: true, result };
}

async function main() {
  const raw = readFileSync(URLS_PATH, "utf8");
  const entries = JSON.parse(raw);
  console.log(`Checking ${entries.length} URLs from ${URLS_PATH} ...`);

  const passed = [];
  const dropped = [];
  let i = 0;
  for (const entry of entries) {
    i++;
    const { ok, reason, result } = await checkOne(entry);
    if (ok) {
      passed.push(result);
    } else {
      dropped.push({ url: entry.url, domain: entry.domain, reason });
    }
    console.log(`${i}/${entries.length} ${entry.domain} ${ok ? "OK" : "DROP:" + reason}`);
  }

  writeFileSync(URLS_PATH, JSON.stringify(passed, null, 2) + "\n");

  console.log("");
  console.log(`Passed: ${passed.length}/${entries.length}`);
  console.log(`Dropped: ${dropped.length}`);
  if (dropped.length) {
    const byReason = {};
    for (const d of dropped) byReason[d.reason] = (byReason[d.reason] || 0) + 1;
    console.log("Drop reasons:", JSON.stringify(byReason, null, 2));
    console.log("Dropped URLs:");
    for (const d of dropped) console.log(`  [${d.domain}] ${d.url} (${d.reason})`);
  }
  if (passed.length < 180) {
    console.warn(
      `WARNING: only ${passed.length} entries passed, below the ROADMAP 2.5 minimum of 180. ` +
        `Add more candidate URLs and re-run.`
    );
    process.exitCode = 1;
  }
}

main();
