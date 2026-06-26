import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { Insight } from "../shared/kb.ts";

process.env.XFEED_DB_PATH = ":memory:";
rmSync("/tmp/pragyan-caps-kb", { recursive: true, force: true });
process.env.XFEED_KB_DIR = "/tmp/pragyan-caps-kb";
const { runCapability } = await import("./capabilities.ts");

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

test("get_signals returns a snapshot object", async () => {
  const signals = await runCapability("get_signals", {});
  assert.equal(typeof signals, "object");
});

test("unknown capability returns an error object", async () => {
  const r = (await runCapability("nope", {})) as { error?: string };
  assert.ok(r.error);
});
