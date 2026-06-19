import test from "node:test";
import assert from "node:assert/strict";
import type { Insight } from "../shared/kb.ts";
import { action } from "./action.ts";

function insight(over: Partial<Insight> = {}): Insight {
  return {
    id: "1",
    report_id: null,
    topic: null,
    status: "pending",
    title: "Rotate into energy infra",
    body: "...",
    rationale: "capex thesis",
    source_refs: ["1900000000000000001"],
    created_at: "2026-06-01T00:00:00.000Z",
    approved_at: null,
    rejected_at: null,
    acted_at: null,
    action_result: null,
    ...over,
  };
}

test("action fails closed when an insight has no provenance", () => {
  assert.match(action(insight({ source_refs: [] })), /fail-closed/);
});

test("action fails closed when an insight has no title", () => {
  assert.match(action(insight({ title: "  " })), /fail-closed/);
});

test("action notifies for a grounded insight (notify-only, no auto-act)", () => {
  assert.match(action(insight()), /notified/);
});
