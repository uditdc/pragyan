// Capability descriptors — the single source of truth for what pragyan exposes to
// Claude. Both the REST surface (api/server.ts) and the MCP server (api/mcp.ts)
// derive from this list, so adding a tool is one entry + one handler branch.
// This module imports nothing heavy (no DB) so the MCP process stays a thin client.

export type CapabilityKind = "read" | "memory" | "hands" | "write" | "job";

export interface CapabilityDescriptor {
  name: string;
  kind: CapabilityKind;
  description: string;
  inputSchema: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties,
});
const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };

export const CAPABILITIES: CapabilityDescriptor[] = [
  // ── read / research ──
  {
    name: "search_feed",
    kind: "read",
    description: "Search harvested feed posts by keyword and/or author, most recent first.",
    inputSchema: obj({ query: str, author: str, news_only: bool, since_hours: num, min_score: num, limit: num }),
  },
  {
    name: "recent_feed",
    kind: "read",
    description: "Most recent feed posts without keyword filtering.",
    inputSchema: obj({ news_only: bool, limit: num }),
  },
  {
    name: "get_report",
    kind: "read",
    description:
      "The living day report (markdown) for a day (YYYY-MM-DD, default today) — includes window_end, the high-water mark of posts already covered.",
    inputSchema: obj({ day: str }),
  },
  {
    name: "list_reports",
    kind: "read",
    description: "Past day reports, most recent first (metadata + tldr, no body).",
    inputSchema: obj({ limit: num }),
  },
  {
    name: "get_top_topics",
    kind: "read",
    description: "Configured interest topics ranked by recent scored-post volume and relevance.",
    inputSchema: obj({ limit: num }),
  },
  {
    name: "get_signals",
    kind: "read",
    description: "Cross-signals (crypto, indices, prediction markets) to correlate against the feed.",
    inputSchema: obj({}),
  },
  {
    name: "get_trending",
    kind: "read",
    description: "Posts gaining engagement fastest (by velocity) in the last 24h — what's moving now.",
    inputSchema: obj({ limit: num }),
  },
  // ── memory ──
  {
    name: "query_memory",
    kind: "memory",
    description: "Query the corpus by keyword/topic/entity/author over time.",
    inputSchema: obj({ query: str, topic: str, entity: str, author: str, since: str, limit: num }),
  },
  {
    name: "get_dossier",
    kind: "memory",
    description: "Get the living dossier (accumulated understanding) for a topic.",
    inputSchema: obj({ topic: str }),
  },
  {
    name: "list_dossiers",
    kind: "memory",
    description:
      "All existing dossiers (topic + last updated, no body). Check before update_dossier and reuse the exact existing topic string — a near-duplicate name forks a second dossier.",
    inputSchema: obj({}),
  },
  {
    name: "get_insights",
    kind: "memory",
    description: "Stored insights, optionally filtered by status (pending/approved/rejected/acted).",
    inputSchema: obj({ status: str, limit: num }),
  },
  {
    name: "get_changes",
    kind: "memory",
    description: "Structured diff of what changed since a timestamp: newly scored posts, new entities, events.",
    inputSchema: obj({ since: str }),
  },
  {
    name: "get_job",
    kind: "memory",
    description: "Poll the status/result of an async job (e.g. a harvest).",
    inputSchema: obj({ id: num }),
  },
  // ── hands ──
  {
    name: "request_harvest",
    kind: "hands",
    description:
      "Ask pragyan to harvest more material (v1: a targeted Google News query). Returns a job_id; poll get_job. Work runs while you're away.",
    inputSchema: obj({ query: str, profile: str, thread_id: str }),
  },
  // ── write ──
  {
    name: "submit_insight",
    kind: "write",
    description:
      "Store an actionable insight (status starts pending, awaits one human approval), or pass the id of an existing pending insight to revise it in place instead of filing a duplicate — check get_insights(status: pending) first. A revision replaces title/body/rationale and unions source_refs. source_refs: post ids or URLs.",
    inputSchema: obj({ id: str, topic: str, title: str, body: str, rationale: str, source_refs: { type: "array" } }),
  },
  {
    name: "submit_lead",
    kind: "write",
    description: "Leave a breadcrumb / thread-to-pull for a future loop.",
    inputSchema: obj({ note: str, topic: str }),
  },
  {
    name: "submit_report",
    kind: "write",
    description:
      "Upsert today's living day report (shown on the dashboard, durable in .kb/daily/): tldr (2-3 sentences for the whole day), markdown body ('## KICKER — headline' sections, bullets only), source_refs = post ids cited. Revisions accumulate provenance; fails closed if ungrounded.",
    inputSchema: obj({ tldr: str, markdown: str, source_refs: { type: "array" } }),
  },
  {
    name: "update_dossier",
    kind: "write",
    description:
      "Replace a topic's living dossier state with your updated understanding. The topic string keys the file — call list_dossiers first and reuse the existing name. Returns created: true when this made a brand-new dossier rather than updating one.",
    inputSchema: obj({ topic: str, state: str }),
  },
];
