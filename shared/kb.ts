// Knowledge-base contracts shared by the API, the MCP server, and the TUI.
// Reports/insights are Claude-authored; provenance (citations / source_refs) may
// reference post ids OR external URLs (Claude's own web research).

export type InsightStatus = "pending" | "approved" | "rejected" | "acted";

export type EntityKind = "person" | "org" | "ticker" | "product" | "place" | "topic" | "other";

export type EventKind = "view" | "dismiss" | "approve" | "reject" | "act";

export interface Topic {
  id: number;
  label: string;
  priority: number;
  relevance: number;
  last_ranked_at: string | null;
  created_at: string;
}

export interface Entity {
  id: number;
  kind: string;
  name: string;
  aliases: string[];
  first_seen: string;
  last_seen: string;
  mention_count: number;
}

export interface Citation {
  kind: "post" | "url";
  ref: string;
  label: string;
}

export interface Report {
  id: number;
  created_at: string;
  author: string;
  topic_id: number | null;
  title: string;
  body: string;
  opinion: string;
  citations: Citation[];
  model: string | null;
}

export interface Insight {
  id: number;
  report_id: number | null;
  topic_id: number | null;
  status: InsightStatus;
  title: string;
  body: string;
  rationale: string;
  source_refs: string[];
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  acted_at: string | null;
  action_result: string | null;
}

export interface Lead {
  id: number;
  note: string;
  topic_id: number | null;
  created_at: string;
  consumed_at: string | null;
}

export interface Dossier {
  topic_id: number;
  state: string;
  updated_at: string | null;
  updated_by: string | null;
}
