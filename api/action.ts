import type { Insight } from "../shared/kb.ts";

// The "then act" step. Notify/log-only to start — it never auto-acts on the world,
// and fails closed on malformed insights (no provenance). Real actuators register
// here later, always behind the single-human-approval gate (docs/plans/phase6.md).
export function action(insight: Insight): string {
  if (!insight.source_refs || insight.source_refs.length === 0) {
    return "fail-closed: insight has no source_refs (ungrounded)";
  }
  if (!insight.title.trim()) {
    return "fail-closed: insight has no title";
  }
  const msg = `notified: "${insight.title}" (${insight.source_refs.length} source ref(s))`;
  console.log(`[action] ${msg}`);
  return msg;
}
