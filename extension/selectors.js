// ALL X DOM selectors and tweet parsing live here. X changes its markup often:
// when harvesting breaks, inspect the live DOM and fix selectors in this file only.
// Each extractor fails soft (returns a default) so one missing field never drops a post.

(function () {
  const TWEET = 'article[data-testid="tweet"]';

  const SEL = {
    text: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    socialContext: '[data-testid="socialContext"]',
    group: '[role="group"]',
    photo: '[data-testid="tweetPhoto"]',
    video: 'video, [data-testid="videoComponent"], [data-testid="videoPlayer"]',
    card: '[data-testid="card.wrapper"]',
    promoted: '[data-testid="placementTracking"]',
    statusLink: 'a[href*="/status/"]',
  };

  function parseCount(raw) {
    if (!raw) return 0;
    const s = String(raw).trim().replace(/,/g, "");
    const m = s.match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (Number.isNaN(n)) return 0;
    const unit = (m[2] || "").toUpperCase();
    if (unit === "K") n *= 1e3;
    else if (unit === "M") n *= 1e6;
    else if (unit === "B") n *= 1e9;
    return Math.round(n);
  }

  function statusInfo(article) {
    for (const a of article.querySelectorAll(SEL.statusLink)) {
      if (!a.querySelector("time")) continue;
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!m) continue;
      const time = a.querySelector("time");
      return {
        handle: "@" + m[1],
        id: m[2],
        created_at: time && time.getAttribute("datetime"),
        url: "https://x.com/" + m[1] + "/status/" + m[2],
      };
    }
    return null;
  }

  function textOf(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function authorName(article) {
    const u = article.querySelector(SEL.userName);
    if (!u) return "";
    return textOf(u).split("\n")[0].split("@")[0].trim();
  }

  function mainText(article) {
    const el = article.querySelector(SEL.text);
    return el ? textOf(el) : "";
  }

  function quotedText(article) {
    const q = article.querySelector('div[role="link"] ' + SEL.text);
    return q ? textOf(q) : null;
  }

  function spanExists(article, exact) {
    for (const s of article.querySelectorAll("span, div")) {
      if (s.textContent === exact) return true;
    }
    return false;
  }

  function metrics(article) {
    const out = { replies: 0, reposts: 0, likes: 0, views: 0 };
    const group = article.querySelector(SEL.group + "[aria-label]");
    const label = group && group.getAttribute("aria-label");
    if (label) {
      const grab = (re) => {
        const m = label.match(re);
        return m ? parseCount(m[1]) : 0;
      };
      out.replies = grab(/([\d,.]+)\s+repl/i);
      out.reposts = grab(/([\d,.]+)\s+(?:repost|retweet)/i);
      out.likes = grab(/([\d,.]+)\s+like/i);
      out.views = grab(/([\d,.]+)\s+view/i);
      if (out.replies || out.reposts || out.likes || out.views) return out;
    }
    const btn = (testid) => {
      const el = article.querySelector(`[data-testid="${testid}"]`);
      return el ? parseCount(el.textContent) : 0;
    };
    out.replies = btn("reply");
    out.reposts = btn("retweet");
    out.likes = btn("like");
    return out;
  }

  function mediaTypes(article) {
    const types = [];
    const hasVideo = !!article.querySelector(SEL.video);
    if (hasVideo) types.push("video");
    if (!hasVideo && article.querySelector(SEL.photo + " img")) types.push("photo");
    if (article.querySelector(SEL.card)) types.push("card");
    return types;
  }

  function parseTweet(article) {
    const status = statusInfo(article);
    if (!status || !status.id) return null;

    const sc = article.querySelector(SEL.socialContext);
    const scText = sc ? sc.textContent || "" : "";
    const quoted = quotedText(article);

    return {
      id: status.id,
      author_handle: status.handle,
      author_name: authorName(article),
      text: mainText(article),
      created_at: status.created_at,
      url: status.url,
      is_repost: /repost|retweet/i.test(scText),
      is_quote: quoted != null,
      is_reply: spanExists(article, "Replying to"),
      is_ad:
        /promoted/i.test(scText) ||
        spanExists(article, "Promoted") ||
        spanExists(article, "Ad") ||
        !!article.querySelector(SEL.promoted),
      is_thread: spanExists(article, "Show this thread"),
      thread_id: null,
      quoted_text: quoted,
      media_types: mediaTypes(article),
      metrics: metrics(article),
    };
  }

  globalThis.PragyanSelectors = { TWEET, parseTweet };
})();
