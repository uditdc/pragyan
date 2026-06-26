import test from "node:test";
import assert from "node:assert/strict";
import type { HarvestedPost } from "../shared/post.ts";

process.env.XFEED_DB_PATH = ":memory:";
const {
  upsertPost,
  recordObservation,
  getPostMetricsHistory,
  getPostVelocity,
  getPostSeen,
  getAuthor,
} = await import("./db.ts");

let seq = 0;
function harvested(over: Partial<HarvestedPost> = {}): HarvestedPost {
  const id = over.id ?? `t${++seq}`;
  return {
    id,
    source: "x",
    author_handle: "@author",
    author_name: "Author",
    text: "a substantial post body",
    created_at: "2026-06-01T00:00:00.000Z",
    url: `https://x.com/author/status/${id}`,
    is_repost: false,
    is_quote: false,
    is_reply: false,
    is_ad: false,
    is_thread: false,
    thread_id: null,
    quoted_text: null,
    media_types: [],
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    harvested_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function observe(post: HarvestedPost, observed_at: string, kept = true, feed_position: number | null = null) {
  upsertPost({ post, kept, drop_reason: null, clickbait_heuristic: 0, scores: null, scored_at: null });
  recordObservation({ post, kept, observed_at, feed_position });
}

test("appends a metric snapshot on first observation", () => {
  const p = harvested({ id: "first", metrics: { replies: 1, reposts: 2, likes: 3, views: 40 } });
  observe(p, "2026-06-01T01:00:00.000Z");
  const hist = getPostMetricsHistory("first");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].engagement, 5); // likes 3 + reposts 2
});

test("appends a new snapshot only when metrics change", () => {
  const p = harvested({ id: "trend", metrics: { replies: 0, reposts: 0, likes: 10, views: 100 } });
  observe(p, "2026-06-01T01:00:00.000Z");
  observe(p, "2026-06-01T01:30:00.000Z"); // identical metrics → no new row
  assert.equal(getPostMetricsHistory("trend").length, 1);

  const grown = harvested({ id: "trend", metrics: { replies: 0, reposts: 0, likes: 50, views: 500 } });
  observe(grown, "2026-06-01T02:00:00.000Z"); // changed → new row
  assert.equal(getPostMetricsHistory("trend").length, 2);
});

test("velocity is Δengagement / Δhours", () => {
  const p1 = harvested({ id: "vel", metrics: { replies: 0, reposts: 0, likes: 0, views: 0 } });
  observe(p1, "2026-06-01T00:00:00.000Z");
  const p2 = harvested({ id: "vel", metrics: { replies: 0, reposts: 0, likes: 200, views: 9000 } });
  observe(p2, "2026-06-01T02:00:00.000Z"); // +200 engagement over 2h
  assert.equal(getPostVelocity("vel"), 100);
});

test("velocity is null with a single snapshot", () => {
  const p = harvested({ id: "single", metrics: { replies: 0, reposts: 0, likes: 5, views: 5 } });
  observe(p, "2026-06-01T00:00:00.000Z");
  assert.equal(getPostVelocity("single"), null);
});

test("post_seen dedups per observed_at but records recurrence", () => {
  const p = harvested({ id: "seen" });
  observe(p, "2026-06-01T00:00:00.000Z", true, 3);
  observe(p, "2026-06-01T00:00:00.000Z", true, 3); // same batch timestamp → ignored
  observe(p, "2026-06-01T00:10:00.000Z", true, 12); // later recurrence → recorded
  const seen = getPostSeen("seen");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.feed_position), [3, 12]);
});

test("author profile accumulates post_count and kept_count across observations", () => {
  const a = harvested({ id: "a1", author_handle: "@voice", author_name: "Voice" });
  const b = harvested({ id: "a2", author_handle: "@voice", author_name: "Voice" });
  observe(a, "2026-06-01T00:00:00.000Z", true);
  observe(b, "2026-06-01T01:00:00.000Z", false);
  const profile = getAuthor("@voice");
  assert.ok(profile);
  assert.equal(profile.post_count, 2);
  assert.equal(profile.kept_count, 1);
  assert.equal(profile.first_seen, "2026-06-01T00:00:00.000Z");
  assert.equal(profile.last_seen, "2026-06-01T01:00:00.000Z");
});
