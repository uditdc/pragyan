import express from "express";
import type { HarvestedPost, IngestResult } from "../shared/post.ts";
import { config } from "./config.ts";
import { prefilter } from "./prefilter.ts";
import { dummyScore } from "./dummyScorer.ts";
import { postExists, upsertPost, queryFeed } from "./db.ts";

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
    const post: HarvestedPost = { ...raw, harvested_at: raw.harvested_at ?? now };

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
  });
  res.json(result);
});

app.listen(config.server.port, config.server.host, () => {
  console.log(
    `x-feed-filter API on http://${config.server.host}:${config.server.port}`,
  );
});
