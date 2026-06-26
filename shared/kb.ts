// Knowledge-base contracts shared by the API, the MCP server, and the TUI.
// Insights are Claude-authored; provenance (source_refs) may reference post ids
// OR external URLs (Claude's own web research).

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

// Filesystem-backed (api/kbstore.ts): Claude's prose artifacts live as Markdown
// files with a JSON frontmatter header, indexed by pragyan — never in the DB.
// ids are filename-stable strings.
export interface Insight {
  id: string;
  topic: string | null;
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
  id: string;
  note: string;
  topic: string | null;
  created_at: string;
  consumed_at: string | null;
}

export interface Dossier {
  topic: string;
  state: string;
  updated_at: string | null;
  updated_by: string | null;
}
