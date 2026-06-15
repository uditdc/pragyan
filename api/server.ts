import express from "express";
import type { HarvestedPost, IngestResult } from "../shared/post.ts";
import { config } from "./config.ts";
import { prefilter } from "./prefilter.ts";
import { dummyScore } from "./dummyScorer.ts";
import {
  postExists,
  upsertPost,
  queryFeed,
  markViewed,
  dismiss,
  undismiss,
  getLatestSummary,
  getSummaries,
  countNewSince,
} from "./db.ts";
import { getSnapshot, startMarkets } from "./markets.ts";
import { startNews } from "./news.ts";
import { getUptimeSnapshot, startUptime, checkNow } from "./uptime.ts";
import { startSummary, tick as generateSummary } from "./summaryGenerator.ts";

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
    const scores = verdict.kept ? dummyScore(post, verdict.clickbait_heuristic) : null;

    upsertPost({
      post,
      kept: verdict.kept,
      drop_reason: verdict.drop_reason,
      clickbait_heuristic: verdict.clickbait_heuristic,
      scores,
      scored_at: scores ? now : null,
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
    news_only: q.news_only === "true",
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

startMarkets();
startNews();
startSummary();

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
