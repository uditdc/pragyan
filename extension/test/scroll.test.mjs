import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;

let articleSeq = 0;
function appendTweets(n) {
  for (let i = 0; i < n; i++) {
    const id = `19999999999000000${String(++articleSeq).padStart(2, "0")}`;
    const el = window.document.createElement("article");
    el.setAttribute("data-testid", "tweet");
    el.innerHTML = `
      <div data-testid="User-Name"><span>User ${articleSeq}</span></div>
      <a href="/user/status/${id}"><time datetime="2026-06-01T12:00:00Z">1m</time></a>
      <div data-testid="tweetText">post number ${articleSeq}</div>
      <div role="group" aria-label="1 reply, 2 reposts, 3 likes, 40 views"></div>`;
    window.document.body.appendChild(el);
  }
}

const PAGES = 4;
const PER_PAGE = 3;
let pagesLoaded = 0;
appendTweets(PER_PAGE);
pagesLoaded = 1;

window.innerHeight = 800;
window.scrollBy = () => {
  if (pagesLoaded < PAGES) {
    appendTweets(PER_PAGE);
    pagesLoaded++;
  }
};

const ingested = [];
globalThis.chrome = {
  runtime: {
    lastError: undefined,
    sendMessage: (msg, cb) => {
      ingested.push(...msg.posts);
      cb({ ok: true, data: { received: msg.posts.length } });
    },
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: (defaults) =>
        Promise.resolve({
          ...defaults,
          autoScroll: true,
          batchSize: 100,
          scrollCap: 50,
          emptyStop: 3,
          minDelayMs: 1,
          maxDelayMs: 2,
          settleTimeoutMs: 40,
          settleIntervalMs: 5,
          reloadOnDone: false,
        }),
    },
  },
};

new Function(readFileSync(join(here, "..", "selectors.js"), "utf8")).call(globalThis);
new Function(readFileSync(join(here, "..", "content.js"), "utf8")).call(globalThis);

const TOTAL = PAGES * PER_PAGE;
const deadline = Date.now() + 8000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
  const badge = window.document.querySelector("div[title]");
  if (badge && /✓ done/.test(badge.textContent) && ingested.length >= TOTAL) break;
}

const badge = window.document.querySelector("div[title]");
const ids = new Set(ingested.map((p) => p.id));
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log("FAIL " + msg);
  } else {
    console.log("✓ " + msg);
  }
};

check(ingested.length === TOTAL, `ingested all ${TOTAL} tweets (got ${ingested.length})`);
check(ids.size === TOTAL, `no duplicates (${ids.size} unique)`);
check(pagesLoaded === PAGES, `scrolled until content exhausted (${pagesLoaded}/${PAGES} pages)`);
check(badge && /✓ done/.test(badge.textContent), "loop reached 'done' via emptyStop");
console.log("badge:", badge && badge.textContent);

if (failures) {
  console.log(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nauto-scroll loop assertions passed");
process.exit(0);
