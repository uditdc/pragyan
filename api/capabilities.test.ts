import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { HarvestedPost } from "../shared/post.ts";
import type { Insight } from "../shared/kb.ts";
import type { ReportRecord } from "../shared/report.ts";

process.env.XFEED_DB_PATH = ":memory:";
rmSync("/tmp/pragyan-caps-kb", { recursive: true, force: true });
process.env.XFEED_KB_DIR = "/tmp/pragyan-caps-kb";
const { runCapability } = await import("./capabilities.ts");
const { upsertPost } = await import("./db.ts");
const { getReport, localDay, setInsightStatus } = await import("./kbstore.ts");

test("submit_insight is pending and listed by get_insights", async () => {
  const insight = (await runCapability("submit_insight", {
    topic: "economics",
    title: "Rotate into energy infra",
    body: "...",
    rationale: "capex thesis",
    source_refs: ["https://example.com/a"],
  })) as Insight;
  assert.equal(insight.status, "pending");
  const pending = (await runCapability("get_insights", { status: "pending" })) as Insight[];
  assert.ok(pending.some((i) => i.id === insight.id));
});

test("submit_insight with an id revises the pending insight instead of duplicating", async () => {
  const original = (await runCapability("submit_insight", {
    topic: "iran",
    title: "Watch crude repricing",
    body: "first take",
    rationale: "escalation",
    source_refs: ["p1"],
  })) as Insight;

  const revised = (await runCapability("submit_insight", {
    id: original.id,
    title: "Watch crude repricing (day 2)",
    body: "crude sustained the move",
    rationale: "",
    source_refs: ["p2"],
  })) as Insight;
  assert.equal(revised.id, original.id);
  assert.equal(revised.title, "Watch crude repricing (day 2)");
  assert.equal(revised.body, "crude sustained the move");
  assert.equal(revised.rationale, "escalation");
  assert.deepEqual([...revised.source_refs].sort(), ["p1", "p2"]);
  assert.equal(revised.created_at, original.created_at);
  assert.ok(revised.updated_at);

  const pending = (await runCapability("get_insights", { status: "pending" })) as Insight[];
  assert.equal(pending.filter((i) => i.id === original.id).length, 1);
});

test("submit_insight revision fails for unknown ids and non-pending insights", async () => {
  const missing = (await runCapability("submit_insight", { id: "nope", title: "x" })) as { error?: string };
  assert.ok(missing.error);

  const approved = (await runCapability("submit_insight", {
    topic: "iran",
    title: "Already approved",
    body: "b",
    rationale: "r",
    source_refs: ["p1"],
  })) as Insight;
  setInsightStatus(approved.id, "approved", new Date().toISOString());
  const rejected = (await runCapability("submit_insight", { id: approved.id, title: "rewrite" })) as {
    error?: string;
  };
  assert.ok(rejected.error);
});

test("get_top_topics returns ranked seeded topics", async () => {
  const topics = (await runCapability("get_top_topics", { limit: 3 })) as Array<{ label: string }>;
  assert.ok(Array.isArray(topics));
  assert.ok(topics.length > 0 && topics.length <= 3);
});

test("update_dossier then get_dossier round-trips", async () => {
  await runCapability("update_dossier", { topic: "ai", state: "AI capex is the macro story" });
  const got = (await runCapability("get_dossier", { topic: "ai" })) as { dossier: { state: string } | null };
  assert.ok(got.dossier);
  assert.equal(got.dossier.state, "AI capex is the macro story");
});

test("update_dossier flags creation and list_dossiers exposes existing topics", async () => {
  const first = (await runCapability("update_dossier", {
    topic: "Iran-Hormuz crisis",
    state: "v1",
  })) as { ok: boolean; created: boolean };
  assert.equal(first.created, true);

  const second = (await runCapability("update_dossier", {
    topic: "Iran-Hormuz crisis",
    state: "v2",
  })) as { ok: boolean; created: boolean };
  assert.equal(second.created, false);

  const listed = (await runCapability("list_dossiers", {})) as Array<{ topic: string; updated_at: string }>;
  assert.ok(listed.some((d) => d.topic === "Iran-Hormuz crisis"));
  assert.ok(listed.every((d) => !("state" in d)));
});

test("get_signals returns a snapshot object", async () => {
  const signals = await runCapability("get_signals", {});
  assert.equal(typeof signals, "object");
});

test("unknown capability returns an error object", async () => {
  const r = (await runCapability("nope", {})) as { error?: string };
  assert.ok(r.error);
});

function post(id: string, harvested_at: string): HarvestedPost {
  return {
    id,
    source: "x",
    author_handle: "@a",
    author_name: "A",
    text: "a substantial post about ai infrastructure",
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

test("submit_report fails closed when ungrounded or incomplete", async () => {
  const noRefs = (await runCapability("submit_report", {
    tldr: "t",
    markdown: "## DEV — x",
    source_refs: [],
  })) as { error?: string };
  assert.ok(noRefs.error);

  const noBody = (await runCapability("submit_report", {
    tldr: "t",
    markdown: "",
    source_refs: ["p1"],
  })) as { error?: string };
  assert.ok(noBody.error);
  assert.equal(getReport(localDay()), null);
});

test("submit_report writes today's living report and revisions accumulate", async () => {
  upsertPost({ post: post("s1", "2026-07-01T10:00:00.000Z"), kept: true, drop_reason: null, clickbait_heuristic: 0, scores: null, scored_at: null });
  upsertPost({ post: post("s2", "2026-07-01T12:00:00.000Z"), kept: true, drop_reason: null, clickbait_heuristic: 0, scores: null, scored_at: null });

  const first = (await runCapability("submit_report", {
    tldr: "AI infra chatter dominated the morning.",
    markdown: "## DEV — infra push\nBuilders shipped. @a led the thread.\n\n## VOICES\n- @a — shipped the thing",
    source_refs: ["s1"],
  })) as { ok?: boolean; day?: string; revision?: number };
  assert.equal(first.ok, true);
  assert.equal(first.day, localDay());
  assert.equal(first.revision, 1);

  const second = (await runCapability("submit_report", {
    tldr: "Infra push led the day; export rules landed midday.",
    markdown: "## MACRO — export rules\nNew licensing rules landed.\n\n## DEV — infra push\nStill moving. @a again.\n\n## VOICES\n- @a — shipped the thing",
    source_refs: ["s2"],
  })) as { ok?: boolean; revision?: number };
  assert.equal(second.revision, 2);

  const report = getReport(localDay()) as ReportRecord;
  assert.equal(report.revision, 2);
  assert.deepEqual([...report.source_refs].sort(), ["s1", "s2"]);
  assert.equal(report.item_count, 2);
  assert.equal(report.window_end, "2026-07-01T12:00:00.000Z");
  assert.ok(report.markdown.includes("## MACRO"));

  const listed = (await runCapability("list_reports", { limit: 5 })) as Array<{ day: string; revision: number }>;
  assert.equal(listed[0].day, localDay());
  assert.equal(listed[0].revision, 2);

  const got = (await runCapability("get_report", {})) as { report: ReportRecord | null };
  assert.equal(got.report?.tldr, "Infra push led the day; export rules landed midday.");
});
