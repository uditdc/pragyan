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

test("report round-trips with mixed post + url citations", () => {
  const r = db.insertReport({
    created_at: NOW,
    author: "claude",
    topic_id: null,
    title: "AI capex is reshaping power markets",
    body: "synthesis...",
    opinion: "watch utilities",
    citations: [
      { kind: "post", ref: "1900000000000000001", label: "@mvela" },
      { kind: "url", ref: "https://example.com/a", label: "Example" },
    ],
    model: "gpt-oss-120b",
  });
  const got = db.getReport(r.id);
  assert.ok(got);
  assert.equal(got.citations.length, 2);
  assert.equal(got.citations[1].kind, "url");
});

test("insight is pending then approves with a timestamp", () => {
  const i = db.insertInsight({
    report_id: null,
    topic_id: null,
    title: "Accumulate energy infra exposure",
    body: "...",
    rationale: "capex thesis",
    source_refs: ["1900000000000000001"],
    created_at: NOW,
  });
  assert.equal(i.status, "pending");
  assert.ok(db.listInsights("pending", 10).some((x) => x.id === i.id));

  const approved = db.setInsightStatus(i.id, "approved", "2026-06-01T02:00:00.000Z");
  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approved_at, "2026-06-01T02:00:00.000Z");
});

test("entity mentions accumulate across posts", () => {
  db.recordEntityMention("org", "OpenAI", { post_id: "p1" }, NOW);
  db.recordEntityMention("org", "OpenAI", { post_id: "p2" }, "2026-06-01T01:00:00.000Z");
  const openai = db.listEntities(50).find((e) => e.name === "OpenAI" && e.kind === "org");
  assert.ok(openai);
  assert.equal(openai.mention_count, 2);
});

test("topic dossier upserts in place", () => {
  const topic = db.getTopicByLabel("ai");
  assert.ok(topic);
  db.upsertDossier(topic.id, "first state", "claude", NOW);
  db.upsertDossier(topic.id, "updated state", "claude", "2026-06-01T03:00:00.000Z");
  const d = db.getDossier(topic.id);
  assert.ok(d);
  assert.equal(d.state, "updated state");
  assert.equal(d.updated_at, "2026-06-01T03:00:00.000Z");
});

test("events are recorded and queryable since a cursor", () => {
  db.recordEvent("approve", { insight_id: 1 }, "2026-06-01T05:00:00.000Z");
  const since = db.getEventsSince("2026-06-01T04:00:00.000Z", 50);
  assert.ok(since.some((e) => e.kind === "approve"));
});
