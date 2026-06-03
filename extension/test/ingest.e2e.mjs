import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const apiBase = process.env.XFEED_API ?? "http://127.0.0.1:8787";

const dom = new JSDOM(`<!doctype html><body></body>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
new Function(readFileSync(join(here, "..", "selectors.js"), "utf8")).call(globalThis);
const { parseTweet } = globalThis.PragyanSelectors;

function article(html) {
  document.body.innerHTML = `<article data-testid="tweet">${html}</article>`;
  return document.querySelector('article[data-testid="tweet"]');
}

const now = new Date().toISOString();
const posts = [
  parseTweet(
    article(`
      <div data-testid="User-Name"><span>Marko Vela</span></div>
      <a href="/mvela/status/1955000000000000001"><time datetime="2026-06-01T11:58:00Z">2m</time></a>
      <div data-testid="tweetText">harvested straight from the DOM into the local API.</div>
      <div data-testid="tweetPhoto"><img src="x"/></div>
      <div role="group" aria-label="3 replies, 12 reposts, 88 likes, 4,200 views"></div>`),
  ),
  parseTweet(
    article(`
      <span>Promoted</span>
      <div data-testid="User-Name"><span>BrandCo</span></div>
      <a href="/brandco/status/1955000000000000002"><time datetime="2026-06-01T11:30:00Z">30m</time></a>
      <div data-testid="tweetText">limited time offer</div>
      <div role="group" aria-label="1 reply, 2 reposts, 9 likes, 500 views"></div>`),
  ),
].map((p) => ({ ...p, harvested_at: now }));

const res = await fetch(`${apiBase}/ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ posts }),
});
if (!res.ok) {
  console.error(`ingest failed: HTTP ${res.status}`);
  process.exit(1);
}
console.log("posted parsed posts →", await res.json());
