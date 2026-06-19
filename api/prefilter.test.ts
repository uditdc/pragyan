import test from "node:test";
import assert from "node:assert/strict";
import type { HarvestedPost } from "../shared/post.ts";
import { engagementOf } from "../shared/post.ts";
import { prefilter } from "./prefilter.ts";

function harvested(over: Partial<HarvestedPost> = {}): HarvestedPost {
  return {
    id: "x",
    source: "x",
    author_handle: "@a",
    author_name: "A",
    text: "a substantial post body",
    created_at: "2026-06-01T00:00:00.000Z",
    url: "https://x.com/a/status/x",
    is_repost: false,
    is_quote: false,
    is_reply: false,
    is_ad: false,
    is_thread: false,
    thread_id: null,
    quoted_text: null,
    media_types: [],
    metrics: { replies: 0, reposts: 0, likes: 5, views: 50 },
    harvested_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

test("engagementOf sums likes + reposts (source-blind scalar)", () => {
  assert.equal(engagementOf({ replies: 9, reposts: 4, likes: 6, views: 999 }), 10);
});

test("keeps a substantial, engaged, non-ad post", () => {
  const v = prefilter(harvested());
  assert.equal(v.kept, true);
  assert.equal(v.drop_reason, null);
});

test("drops ads", () => {
  assert.equal(prefilter(harvested({ is_ad: true })).drop_reason, "ad");
});

test("drops pure replies", () => {
  assert.equal(prefilter(harvested({ is_reply: true })).drop_reason, "pure_reply");
});

test("drops below the engagement floor", () => {
  const v = prefilter(harvested({ metrics: { replies: 0, reposts: 0, likes: 1, views: 0 } }));
  assert.equal(v.drop_reason, "below_engagement_floor");
});

test("drops low-substance text", () => {
  const v = prefilter(harvested({ text: "hi" }));
  assert.equal(v.drop_reason, "no_substance");
});
