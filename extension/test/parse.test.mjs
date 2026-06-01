import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));

const dom = new JSDOM(`<!doctype html><body></body>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const code = readFileSync(join(here, "..", "selectors.js"), "utf8");
new Function(code).call(globalThis);
const { parseTweet } = globalThis.XFeedSelectors;

function makeArticle({ handle, id, name, datetime, text, promoted, replying, thread, quoted, ariaLabel, media }) {
  const mediaHtml =
    media === "photo"
      ? `<div data-testid="tweetPhoto"><img src="x"/></div>`
      : media === "video"
        ? `<div data-testid="videoPlayer"><video></video></div>`
        : media === "card"
          ? `<div data-testid="card.wrapper"></div>`
          : "";
  document.body.innerHTML = `
    <article data-testid="tweet">
      ${promoted ? `<span>Promoted</span>` : ""}
      <div data-testid="User-Name"><span>${name}</span><span>${handle}</span></div>
      ${replying ? `<div><span>Replying to</span></div>` : ""}
      <a href="/${handle.slice(1)}/status/${id}"><time datetime="${datetime}">2m</time></a>
      <div data-testid="tweetText">${text}</div>
      ${quoted ? `<div role="link"><div data-testid="tweetText">${quoted}</div></div>` : ""}
      ${thread ? `<a><span>Show this thread</span></a>` : ""}
      ${mediaHtml}
      <div role="group" aria-label="${ariaLabel}"></div>
    </article>`;
  return document.querySelector('article[data-testid="tweet"]');
}

const cases = [
  {
    name: "plain post with photo + metrics",
    input: {
      handle: "@mvela", id: "1900000000000000001", name: "Marko Vela",
      datetime: "2026-06-01T11:58:00.000Z", text: "streaming the firehose into Ink.",
      ariaLabel: "40 replies, 318 reposts, 1,200 likes, 96,000 views", media: "photo",
    },
    expect: {
      id: "1900000000000000001", author_handle: "@mvela", author_name: "Marko Vela",
      is_reply: false, is_ad: false, is_thread: false, is_quote: false,
      media_types: ["photo"],
      metrics: { replies: 40, reposts: 318, likes: 1200, views: 96000 },
      url: "https://x.com/mvela/status/1900000000000000001",
    },
  },
  {
    name: "promoted ad",
    input: {
      handle: "@brandco", id: "1900000000000000002", name: "BrandCo",
      datetime: "2026-06-01T11:30:00.000Z", text: "buy our thing", promoted: true,
      ariaLabel: "1 reply, 5 reposts, 20 likes, 1,000 views", media: "card",
    },
    expect: { is_ad: true, media_types: ["card"] },
  },
  {
    name: "reply with thread + quote",
    input: {
      handle: "@analyst", id: "1900000000000000003", name: "Tech Analyst",
      datetime: "2026-06-01T11:50:00.000Z", text: "part one", replying: true, thread: true,
      quoted: "the quoted original", ariaLabel: "10 replies, 90 reposts, 500 likes, 40,000 views",
    },
    expect: { is_reply: true, is_thread: true, is_quote: true, quoted_text: "the quoted original" },
  },
];

let failures = 0;
for (const { name, input, expect } of cases) {
  const post = parseTweet(makeArticle(input));
  const actual = JSON.stringify(post);
  for (const [k, v] of Object.entries(expect)) {
    const got = JSON.stringify(post[k]);
    const want = JSON.stringify(v);
    if (got !== want) {
      failures++;
      console.log(`FAIL [${name}] ${k}: got ${got} want ${want}`);
    }
  }
  console.log(`✓ parsed [${name}] id=${post.id} actual=${actual.slice(0, 90)}…`);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall parser assertions passed");
