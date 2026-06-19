import express from "express";
import type { HarvestedPost, IngestResult } from "../shared/post.ts";
import { config } from "./config.ts";
import { prefilter } from "./prefilter.ts";
import {
  postExists,
  upsertPost,
  recordObservation,
  queryFeed,
  markViewed,
  dismiss,
  undismiss,
  getLatestSummary,
  getSummaries,
  countNewSince,
  prunePosts,
} from "./db.ts";
import { getSnapshot, startMarkets } from "./markets.ts";
import { startNews } from "./news.ts";
import { getUptimeSnapshot, startUptime, checkNow } from "./uptime.ts";
import { startSummary, tick as generateSummary } from "./summaryGenerator.ts";
import { startScorer } from "./scorer.ts";
import { runCapability } from "./capabilities.ts";
import { CAPABILITIES } from "./capabilitySchema.ts";
import {
  listInsights,
  listReports,
  getInsight,
  setInsightStatus,
  recordEvent,
} from "./db.ts";
import { action } from "./action.ts";
import type { InsightStatus } from "../shared/kb.ts";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, schema_version: 1 });
});

app.post("/ingest", (req, res) => {
  const posts = req.body?.posts as HarvestedPost[] | undefined;
  if (!Array.isArray(posts)) {
    res.status(400).json({ error: "body must be { posts: Post[] }" });
    return;
  }

  const result: IngestResult = {
    received: posts.length,
    new: 0,
    duplicate: 0,
    flagged_dropped: 0,
  };

  const now = new Date().toISOString();
  for (const raw of posts) {
    if (!raw?.id) continue;
    const isDuplicate = postExists(raw.id);
    const post: HarvestedPost = {
      ...raw,
      source: raw.source ?? "x",
      harvested_at: raw.harvested_at ?? now,
    };

    const verdict = prefilter(post);

    upsertPost({
      post,
      kept: verdict.kept,
      drop_reason: verdict.drop_reason,
      clickbait_heuristic: verdict.clickbait_heuristic,
      scores: null,
      scored_at: null,
    });

    recordObservation({
      post,
      kept: verdict.kept,
      observed_at: now,
      feed_position: typeof post.feed_position === "number" ? post.feed_position : null,
    });

    if (isDuplicate) result.duplicate++;
    else result.new++;
    if (!verdict.kept) result.flagged_dropped++;
  }

  res.json(result);
});

app.get("/feed", (req, res) => {
  const q = req.query;
  const result = queryFeed({
    min_score: Number(q.min_score ?? 0),
    since: typeof q.since === "string" ? q.since : null,
    limit: Math.min(200, Number(q.limit ?? 50)),
    news_only: q.news_only !== undefined ? q.news_only === "true" : config.gates.news_only_default,
    include_dropped: q.include_dropped === "true",
    include_expired: q.include_expired === "true",
    sort: q.sort === "recent" ? "recent" : "score",
  });
  res.json(result);
});

function readIds(req: express.Request, res: express.Response): string[] | null {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "body must be { ids: string[] }" });
    return null;
  }
  return ids;
}

app.post("/viewed", (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;
  res.json({ updated: markViewed(ids, new Date().toISOString()) });
});

app.post("/dismiss", (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;
  res.json({ dismissed: dismiss(ids, new Date().toISOString()) });
});

app.post("/undismiss", (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;
  res.json({ restored: undismiss(ids) });
});

app.get("/markets", (_req, res) => {
  res.json(getSnapshot());
});

app.get("/uptime", (_req, res) => {
  res.json(getUptimeSnapshot());
});

app.post("/uptime/check", async (_req, res) => {
  res.json(await checkNow());
});

app.get("/summary", (_req, res) => {
  const summary = getLatestSummary();
  res.json({
    summary,
    new_since: summary ? countNewSince(summary.window_end) : 0,
  });
});

app.get("/summaries", (req, res) => {
  const limit = Math.min(100, Number(req.query.limit ?? 50));
  const summaries = getSummaries(limit);
  res.json({
    summaries,
    new_since: summaries.length > 0 ? countNewSince(summaries[0].window_end) : 0,
  });
});

app.post("/summary/regenerate", async (_req, res) => {
  await generateSummary();
  res.json(getLatestSummary());
});

app.get("/insights", (req, res) => {
  const status = typeof req.query.status === "string" ? (req.query.status as InsightStatus) : null;
  const limit = Math.min(200, Number(req.query.limit ?? 100) || 100);
  res.json({ insights: listInsights(status, limit) });
});

app.get("/reports", (req, res) => {
  const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
  res.json({ reports: listReports(limit) });
});

app.post("/insights/:id/approve", (req, res) => {
  const id = Number(req.params.id);
  const insight = getInsight(id);
  if (!insight) {
    res.status(404).json({ error: "insight not found" });
    return;
  }
  const now = new Date().toISOString();
  const result = action(insight);
  const updated = setInsightStatus(id, "approved", now, result);
  recordEvent("approve", { insight_id: id }, now);
  res.json({ insight: updated });
});

app.post("/insights/:id/reject", (req, res) => {
  const id = Number(req.params.id);
  const insight = getInsight(id);
  if (!insight) {
    res.status(404).json({ error: "insight not found" });
    return;
  }
  const now = new Date().toISOString();
  const updated = setInsightStatus(id, "rejected", now);
  recordEvent("reject", { insight_id: id }, now);
  res.json({ insight: updated });
});

app.get("/tools", (_req, res) => {
  res.json({ tools: CAPABILITIES });
});

app.post("/tools/:name", async (req, res) => {
  const args = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  try {
    res.json({ result: await runCapability(req.params.name, args) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

startMarkets();
startNews();
startScorer();
startSummary();

setInterval(() => {
  try {
    const pruned = prunePosts(config.maintenance.drop_retention_days);
    if (pruned > 0) console.log(`pruned ${pruned} dropped post(s)`);
  } catch (err) {
    console.error("prune failed:", err instanceof Error ? err.message : err);
  }
}, config.maintenance.interval_ms);

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(
    `x-feed-filter API on http://${config.server.host}:${config.server.port}`,
  );
  startUptime();
});

function shutdown(): void {
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
