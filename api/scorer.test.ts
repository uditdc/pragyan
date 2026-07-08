import test from "node:test";
import assert from "node:assert/strict";
import type { HarvestedPost } from "../shared/post.ts";

process.env.XFEED_DB_PATH = ":memory:";
const { upsertPost, getUnscoredPosts } = await import("./db.ts");
const { scoreQueuedPosts } = await import("./scorer.ts");

function harvested(id: string, over: Partial<HarvestedPost> = {}): HarvestedPost {
  return {
    id,
    source: "x",
    author_handle: "@a",
    author_name: "A",
    text: "a substantial post body about ai and science",
    created_at: "2026-06-01T00:00:00.000Z",
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
    harvested_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function enqueue(p: HarvestedPost) {
  upsertPost({ post: p, kept: true, drop_reason: null, clickbait_heuristic: 0.1, scores: null, scored_at: null });
}

test("kept posts enter the scoring queue (scored_at null)", () => {
  enqueue(harvested("q1"));
  enqueue(harvested("q2"));
  assert.equal(getUnscoredPosts(10).length, 2);
});

test("scoreQueuedPosts drains the queue with heuristic scores", () => {
  const pending = getUnscoredPosts(10);
  assert.ok(pending.length >= 2);
  scoreQueuedPosts(pending, "2026-06-01T01:00:00.000Z");
  assert.equal(getUnscoredPosts(10).length, 0);
});

test("google_news posts score as news; x posts do not", async () => {
  const { dummyScore } = await import("./dummyScorer.ts");
  const news = dummyScore(harvested("n1", { source: "google_news" }), 0.1);
  assert.equal(news.is_news, true);
  assert.equal(news.news_confidence, 1);
  const x = dummyScore(harvested("x1"), 0.1);
  assert.equal(x.is_news, false);
  assert.equal(x.news_confidence, 0);
});
