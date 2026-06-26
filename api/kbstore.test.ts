import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const KB = "/tmp/pragyan-kbstore-test";
rmSync(KB, { recursive: true, force: true });
process.env.XFEED_KB_DIR = KB;
const kb = await import("./kbstore.ts");

const NOW = "2026-06-01T00:00:00.000Z";

test("insight starts pending and approves with a timestamp", () => {
  const i = kb.insertInsight({
    topic: "economics",
    title: "Rotate into energy infra",
    body: "...",
    rationale: "capex thesis",
    source_refs: ["1900000000000000001", "https://example.com/a"],
    created_at: NOW,
  });
  assert.equal(i.status, "pending");
  assert.ok(kb.listInsights("pending", 10).some((x) => x.id === i.id));

  const approved = kb.setInsightStatus(i.id, "approved", "2026-06-01T02:00:00.000Z", "notified");
  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approved_at, "2026-06-01T02:00:00.000Z");
  assert.equal(approved.action_result, "notified");
  // and it persisted
  assert.equal(kb.getInsight(i.id)?.status, "approved");
  assert.equal(kb.listInsights("pending", 10).some((x) => x.id === i.id), false);
});

test("dossier upserts in place (one file per topic)", () => {
  kb.upsertDossier("ai", "first state", "claude", NOW);
  kb.upsertDossier("ai", "updated state", "claude", "2026-06-01T03:00:00.000Z");
  const d = kb.getDossier("ai");
  assert.ok(d);
  assert.equal(d.state, "updated state");
  assert.equal(d.updated_at, "2026-06-01T03:00:00.000Z");
});

test("leads list unconsumed, newest first", () => {
  kb.insertLead("pull the energy thread next loop", "ai", NOW);
  const leads = kb.listLeads(10);
  assert.ok(leads.some((l) => l.note.includes("energy thread")));
});
