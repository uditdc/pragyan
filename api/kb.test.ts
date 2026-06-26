import test from "node:test";
import assert from "node:assert/strict";

process.env.XFEED_DB_PATH = ":memory:";
const db = await import("./db.ts");

const NOW = "2026-06-01T00:00:00.000Z";

test("topics are seeded from interest_topics at load", () => {
  const labels = db.listTopics().map((t) => t.label);
  assert.ok(labels.includes("ai"));
  assert.ok(labels.length >= 5);
});

test("entity mentions accumulate across posts", () => {
  db.recordEntityMention("org", "OpenAI", { post_id: "p1" }, NOW);
  db.recordEntityMention("org", "OpenAI", { post_id: "p2" }, "2026-06-01T01:00:00.000Z");
  const openai = db.listEntities(50).find((e) => e.name === "OpenAI" && e.kind === "org");
  assert.ok(openai);
  assert.equal(openai.mention_count, 2);
});

test("events are recorded and queryable since a cursor", () => {
  db.recordEvent("approve", { insight_id: "abc-123" }, "2026-06-01T05:00:00.000Z");
  const since = db.getEventsSince("2026-06-01T04:00:00.000Z", 50);
  assert.ok(since.some((e) => e.kind === "approve"));
});
