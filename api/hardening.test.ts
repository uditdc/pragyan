import test from "node:test";
import assert from "node:assert/strict";
import type { HarvestedPost, Scores } from "../shared/post.ts";

process.env.XFEED_DB_PATH = ":memory:";
const dbm = await import("./db.ts");
const { validateConfig, config } = await import("./config.ts");

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 30 * 86_400_000).toISOString();

function harvested(id: string, harvested_at: string): HarvestedPost {
  return {
    id,
    source: "x",
    author_handle: "@a",
    author_name: "A",
    text: "a substantial post body",
    created_at: harvested_at,
    url: `https://x.com/a/status/${id}`,
    is_repost: false,
    is_quote: false,
    is_reply: false,
    is_ad: false,
    is_thread: false,
    thread_id: null,
    quoted_text: null,
    media_types: [],
    metrics: { replies: 0, reposts: 5, likes: 50, views: 900 },
    harvested_at,
  };
}
const SCORES: Scores = { relevance: 0.8, importance: 0.7, clickbait: 0.1, is_news: false, news_confidence: 0 };

test("prunePosts removes old dropped noise but preserves kept history", () => {
  dbm.upsertPost({ post: harvested("keptOld", OLD), kept: true, drop_reason: null, clickbait_heuristic: 0.1, scores: SCORES, scored_at: OLD });
  dbm.upsertPost({ post: harvested("dropOld", OLD), kept: false, drop_reason: "below_engagement_floor", clickbait_heuristic: 0.1, scores: null, scored_at: null });
  dbm.upsertPost({ post: harvested("dropNew", NOW), kept: false, drop_reason: "below_engagement_floor", clickbait_heuristic: 0.1, scores: null, scored_at: null });

  const pruned = dbm.prunePosts(7);
  assert.ok(pruned >= 1);
  assert.ok(dbm.getPostById("keptOld"), "kept post preserved");
  assert.equal(dbm.getPostById("dropOld"), null, "old dropped pruned");
  assert.ok(dbm.getPostById("dropNew"), "recent dropped preserved");
});

test("queryFeed returns scored kept posts under score sort", () => {
  dbm.upsertPost({ post: harvested("f1", NOW), kept: true, drop_reason: null, clickbait_heuristic: 0.1, scores: SCORES, scored_at: NOW });
  const res = dbm.queryFeed({
    min_score: 0,
    since: null,
    limit: 50,
    news_only: false,
    include_dropped: false,
    include_expired: false,
    sort: "score",
  });
  assert.ok(res.posts.some((p) => p.id === "f1"));
});

test("validateConfig rejects a non-finite weight", () => {
  assert.throws(() => validateConfig({ ...config, weights: { ...config.weights, importance: NaN } }));
});

test("validateConfig accepts the shipped config", () => {
  assert.doesNotThrow(() => validateConfig(config));
});
