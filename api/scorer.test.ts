import test from "node:test";
import assert from "node:assert/strict";
import type { HarvestedPost } from "../shared/post.ts";

process.env.XFEED_DB_PATH = ":memory:";
const { upsertPost, getUnscoredPosts } = await import("./db.ts");
const { scoreBatchSafe } = await import("./scorer.ts");

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

test("scoreBatchSafe drains the queue via heuristic fallback when no LLM is configured", async () => {
  const pending = getUnscoredPosts(10);
  assert.ok(pending.length >= 2);
  await scoreBatchSafe(pending, "2026-06-01T01:00:00.000Z");
  assert.equal(getUnscoredPosts(10).length, 0);
});
