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
    name: "search_summaries",
    kind: "read",
    description: "Past rolling-digest summaries, most recent first.",
    inputSchema: obj({ since_hours: num, limit: num }),
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
    name: "get_reports",
    kind: "memory",
    description: "Claude's prior reports, most recent first — build on accumulated judgment.",
    inputSchema: obj({ limit: num }),
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
    name: "submit_report",
    kind: "write",
    description: "Store a long-form analysis. citations: [{kind:'post'|'url', ref, label}].",
    inputSchema: obj({ topic: str, title: str, body: str, opinion: str, citations: { type: "array" }, model: str }),
  },
  {
    name: "submit_insight",
    kind: "write",
    description: "Store an actionable insight (status starts pending, awaits one human approval). source_refs: post ids or URLs.",
    inputSchema: obj({ topic: str, report_id: num, title: str, body: str, rationale: str, source_refs: { type: "array" } }),
  },
  {
    name: "submit_lead",
    kind: "write",
    description: "Leave a breadcrumb / thread-to-pull for a future loop.",
    inputSchema: obj({ note: str, topic: str }),
  },
  {
    name: "update_dossier",
    kind: "write",
    description: "Replace a topic's living dossier state with your updated understanding.",
    inputSchema: obj({ topic: str, state: str }),
  },
];
