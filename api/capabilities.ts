import { runTool } from "./tools.ts";
import { getSnapshot } from "./markets.ts";
import { harvestNewsQuery } from "./news.ts";
import type { InsightStatus } from "../shared/kb.ts";
import {
  createJob,
  finishJob,
  getChanges,
  getJob,
  getTopTopics,
  getTrending,
  searchPosts,
  seedTopics,
} from "./db.ts";
import {
  getDossier,
  insertInsight,
  insertLead,
  listInsights,
  upsertDossier,
} from "./kbstore.ts";

const PASSTHROUGH = new Set(["search_feed", "recent_feed", "search_summaries", "get_latest_summary"]);

function clampNum(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function topicOf(label: unknown): string | null {
  if (typeof label !== "string" || !label.trim()) return null;
  seedTopics([label]); // make a Claude-introduced topic discoverable to get_top_topics
  return label;
}

function queryMemory(args: Record<string, unknown>): unknown {
  const text =
    str(args.query) || str(args.topic) || str(args.entity) || null;
  const posts = searchPosts({
    text,
    author: typeof args.author === "string" ? args.author : null,
    news_only: false,
    since: typeof args.since === "string" ? args.since : null,
    min_score: 0,
    limit: clampNum(args.limit, 20, 50),
    include_expired: true,
  });
  return posts.map((p) => ({
    id: p.id,
    author: p.author_handle,
    source: p.source,
    text: p.text.slice(0, 280),
    url: p.url,
    created_at: p.created_at,
    scores: p.scores,
  }));
}

async function runHarvestJob(id: number, args: Record<string, unknown>): Promise<void> {
  const finishNow = () => new Date().toISOString();
  try {
    if (typeof args.query === "string" && args.query.trim()) {
      const n = await harvestNewsQuery(args.query);
      finishJob(id, "done", `ingested ${n} item(s) for "${args.query}"`, finishNow());
    } else {
      finishJob(id, "skipped", "only query harvests are supported in v1 (profile/thread need the extension command channel)", finishNow());
    }
  } catch (err) {
    finishJob(id, "error", err instanceof Error ? err.message : String(err), finishNow());
  }
}

export async function runCapability(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (PASSTHROUGH.has(name)) return runTool(name, args);
  const now = new Date().toISOString();
  switch (name) {
    case "get_top_topics":
      return getTopTopics(clampNum(args.limit, 10, 50));
    case "get_signals":
      return getSnapshot();
    case "get_trending":
      return getTrending(clampNum(args.limit, 15, 50));
    case "query_memory":
      return queryMemory(args);
    case "get_dossier": {
      const topic = topicOf(args.topic);
      return topic ? { topic, dossier: getDossier(topic) } : null;
    }
    case "get_insights":
      return listInsights(
        typeof args.status === "string" ? (args.status as InsightStatus) : null,
        clampNum(args.limit, 20, 100),
      );
    case "get_changes":
      return getChanges(
        typeof args.since === "string" ? args.since : new Date(Date.now() - 86_400_000).toISOString(),
      );
    case "get_job":
      return getJob(Number(args.id));
    case "request_harvest": {
      const job = createJob("harvest", args, now);
      void runHarvestJob(job.id, args);
      return { job_id: job.id, status: job.status };
    }
    case "submit_insight":
      return insertInsight({
        topic: topicOf(args.topic),
        title: str(args.title),
        body: str(args.body),
        rationale: str(args.rationale),
        source_refs: Array.isArray(args.source_refs) ? (args.source_refs as unknown[]).map(String) : [],
        created_at: now,
      });
    case "submit_lead":
      insertLead(str(args.note), topicOf(args.topic), now);
      return { ok: true };
    case "update_dossier": {
      const topic = topicOf(args.topic);
      if (!topic) return { error: "missing topic" };
      upsertDossier(topic, str(args.state), "claude", now);
      return { ok: true };
    }
    default:
      return { error: `unknown capability: ${name}` };
  }
}
