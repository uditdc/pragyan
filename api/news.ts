import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { HarvestedPost, Scores } from "../shared/post.ts";
import { config } from "./config.ts";
import { clickbaitScore } from "./prefilter.ts";
import { postExists, upsertPost } from "./db.ts";

const UA = "pragyan/0.1 (personal use)";
const parser = new XMLParser({ ignoreAttributes: false });

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  source?: { "#text"?: string; "@_url"?: string } | string;
}

function textOf(value: unknown): string {
  if (typeof value === "object" && value !== null && "#text" in value) {
    return String((value as { "#text": unknown })["#text"] ?? "");
  }
  return value == null ? "" : String(value);
}

function outletOf(item: RssItem): { name: string; handle: string } {
  const name = textOf(item.source);
  let handle = "news.google.com";
  if (typeof item.source === "object" && item.source?.["@_url"]) {
    try {
      handle = new URL(item.source["@_url"]).hostname.replace(/^www\./, "");
    } catch {
      // keep fallback
    }
  }
  return { name: name || "Google News", handle: `@${handle}` };
}

// Google News titles are "Headline - Outlet"; strip the outlet suffix.
function headlineOf(title: string, outlet: string): string {
  return outlet && title.endsWith(` - ${outlet}`)
    ? title.slice(0, -(outlet.length + 3))
    : title;
}

function itemToPost(item: RssItem, now: string): HarvestedPost | null {
  const guid = textOf(item.guid);
  const link = textOf(item.link);
  const title = textOf(item.title);
  if (!guid || !title || !link) return null;

  const outlet = outletOf(item);
  const pubDateMs = Date.parse(textOf(item.pubDate));

  return {
    id: `gnews-${createHash("sha1").update(guid).digest("hex").slice(0, 16)}`,
    source: "google_news",
    author_handle: outlet.handle,
    author_name: outlet.name,
    text: headlineOf(title, outlet.name),
    created_at: Number.isNaN(pubDateMs) ? now : new Date(pubDateMs).toISOString(),
    url: link,
    is_repost: false,
    is_quote: false,
    is_reply: false,
    is_ad: false,
    is_thread: false,
    thread_id: null,
    quoted_text: null,
    media_types: [],
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    harvested_at: now,
  };
}

async function fetchTopic(topic: string, now: string): Promise<HarvestedPost[]> {
  const { hl, gl, ceid, per_topic_cap } = config.sources.news;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`google news ${topic}: ${res.status}`);

  const doc = parser.parse(await res.text()) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const items = ([] as RssItem[]).concat(doc.rss?.channel?.item ?? []);
  return items
    .slice(0, per_topic_cap)
    .map((item) => itemToPost(item, now))
    .filter((p): p is HarvestedPost => p !== null);
}

// Headlines carry no engagement, so they bypass the prefilter's engagement
// floor and get fixed mid-pack scores; is_news=true is what makes the TUI and
// summaries treat them as news.
function newsScores(text: string): Scores {
  return {
    relevance: 0.6,
    importance: 0.55,
    clickbait: clickbaitScore(text),
    is_news: true,
    news_confidence: 0.9,
  };
}

async function refresh(): Promise<void> {
  const now = new Date().toISOString();
  const settled = await Promise.allSettled(
    config.interest_topics.map((topic) => fetchTopic(topic, now)),
  );

  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const post of result.value) {
      if (seen.has(post.id) || postExists(post.id)) continue;
      seen.add(post.id);
      const scores = newsScores(post.text);
      upsertPost({
        post,
        kept: true,
        drop_reason: null,
        clickbait_heuristic: scores.clickbait,
        scores,
        scored_at: now,
      });
    }
  }
}

export function startNews(): void {
  if (!config.sources.news.enabled) return;
  void refresh();
  setInterval(() => void refresh(), config.sources.news.poll_interval_ms);
}
