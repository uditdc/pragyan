import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import type { Dossier, Insight, InsightStatus, Lead } from "../shared/kb.ts";

// Filesystem-backed store for Claude's prose artifacts (insights, dossiers,
// leads). Each is a Markdown file with a JSON frontmatter header — human
// readable, greppable, portable — and pragyan only indexes/serves them. The DB
// holds the scraped/pre-processed bulk (posts, entities, events); this does not.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configured = process.env.XFEED_KB_DIR ?? config.kb_dir;
const root = isAbsolute(configured) ? configured : join(repoRoot, configured);

const dirs = {
  insights: join(root, "insights"),
  dossiers: join(root, "dossiers"),
  leads: join(root, "leads"),
};
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

function genId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

// File = JSON frontmatter (the structured record minus its body) + a Markdown body.
function serialize(meta: Record<string, unknown>, body: string): string {
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${body}\n`;
}
function parse(text: string): { meta: Record<string, unknown>; body: string } | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  try {
    return { meta: JSON.parse(m[1]) as Record<string, unknown>, body: m[2].replace(/^\n+/, "").replace(/\s+$/, "") };
  } catch {
    return null;
  }
}
function readRecords(dir: string): Array<{ meta: Record<string, unknown>; body: string }> {
  const out: Array<{ meta: Record<string, unknown>; body: string }> = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const parsed = parse(readFileSync(join(dir, f), "utf8"));
    if (parsed) out.push(parsed);
  }
  return out;
}
function byCreatedDesc(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

// ── insights ──

export interface NewInsight {
  topic: string | null;
  title: string;
  body: string;
  rationale: string;
  source_refs: string[];
  created_at: string;
}
function recordToInsight(meta: Record<string, unknown>, body: string): Insight {
  return {
    id: String(meta.id),
    topic: (meta.topic as string) ?? null,
    status: (meta.status as InsightStatus) ?? "pending",
    title: String(meta.title ?? ""),
    body,
    rationale: String(meta.rationale ?? ""),
    source_refs: Array.isArray(meta.source_refs) ? (meta.source_refs as string[]) : [],
    created_at: String(meta.created_at),
    approved_at: (meta.approved_at as string) ?? null,
    rejected_at: (meta.rejected_at as string) ?? null,
    acted_at: (meta.acted_at as string) ?? null,
    action_result: (meta.action_result as string) ?? null,
  };
}
function writeInsight(i: Insight): void {
  const { body, ...meta } = i;
  writeFileSync(join(dirs.insights, `${i.id}.md`), serialize(meta, body));
}
export function insertInsight(i: NewInsight): Insight {
  const insight: Insight = {
    id: genId(),
    topic: i.topic,
    status: "pending",
    title: i.title,
    body: i.body,
    rationale: i.rationale,
    source_refs: i.source_refs,
    created_at: i.created_at,
    approved_at: null,
    rejected_at: null,
    acted_at: null,
    action_result: null,
  };
  writeInsight(insight);
  return insight;
}
export function getInsight(id: string): Insight | null {
  try {
    const parsed = parse(readFileSync(join(dirs.insights, `${id}.md`), "utf8"));
    return parsed ? recordToInsight(parsed.meta, parsed.body) : null;
  } catch {
    return null;
  }
}
export function listInsights(status: InsightStatus | null, limit: number): Insight[] {
  return readRecords(dirs.insights)
    .map((r) => recordToInsight(r.meta, r.body))
    .filter((i) => (status ? i.status === status : true))
    .sort(byCreatedDesc)
    .slice(0, limit);
}
export function setInsightStatus(
  id: string,
  status: InsightStatus,
  now: string,
  action_result: string | null = null,
): Insight | null {
  const i = getInsight(id);
  if (!i) return null;
  const updated: Insight = {
    ...i,
    status,
    action_result: action_result ?? i.action_result,
    approved_at: status === "approved" ? now : i.approved_at,
    rejected_at: status === "rejected" ? now : i.rejected_at,
    acted_at: status === "acted" ? now : i.acted_at,
  };
  writeInsight(updated);
  return updated;
}

// ── dossiers (one per topic, updated in place) ──

export function getDossier(topic: string): Dossier | null {
  try {
    const parsed = parse(readFileSync(join(dirs.dossiers, `${slug(topic)}.md`), "utf8"));
    if (!parsed) return null;
    return {
      topic: String(parsed.meta.topic ?? topic),
      state: parsed.body,
      updated_at: (parsed.meta.updated_at as string) ?? null,
      updated_by: (parsed.meta.updated_by as string) ?? null,
    };
  } catch {
    return null;
  }
}
export function upsertDossier(topic: string, state: string, updatedBy: string, now: string): void {
  writeFileSync(
    join(dirs.dossiers, `${slug(topic)}.md`),
    serialize({ topic, updated_at: now, updated_by: updatedBy }, state),
  );
}

// ── leads (Claude's breadcrumbs for future loops) ──

export function insertLead(note: string, topic: string | null, now: string): Lead {
  const lead: Lead = { id: genId(), note, topic, created_at: now, consumed_at: null };
  const { note: body, ...meta } = lead;
  writeFileSync(join(dirs.leads, `${lead.id}.md`), serialize(meta, body));
  return lead;
}
export function listLeads(limit: number): Lead[] {
  return readRecords(dirs.leads)
    .map((r) => ({
      id: String(r.meta.id),
      note: r.body,
      topic: (r.meta.topic as string) ?? null,
      created_at: String(r.meta.created_at),
      consumed_at: (r.meta.consumed_at as string) ?? null,
    }))
    .filter((l) => !l.consumed_at)
    .sort(byCreatedDesc)
    .slice(0, limit);
}
