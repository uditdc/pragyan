import type { Post } from "../shared/post.ts";
import { config } from "./config.ts";
import { dummyScore } from "./dummyScorer.ts";
import { getUnscoredPosts, updatePostScores } from "./db.ts";

// Heuristic-only queue drainer — pragyan makes no LLM calls. Real review happens
// in the scheduled Claude Code workflow (/pragyan-tick), which reads the feed
// over MCP and rewrite the day report. This keeps a baseline score on every kept
// post so the feed always ranks (see docs/plans/phase6.md).

export function scoreQueuedPosts(posts: Post[], now: string): void {
  updatePostScores(
    posts.map((p) => ({ id: p.id, scores: dummyScore(p, p.clickbait_heuristic), scored_at: now })),
  );
}

let running = false;

function tick(): void {
  if (running) return;
  running = true;
  try {
    const posts = getUnscoredPosts(config.scoring.batch_size);
    if (posts.length === 0) return;
    scoreQueuedPosts(posts, new Date().toISOString());
  } catch (err) {
    console.error("scorer tick failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startScorer(): void {
  setInterval(() => tick(), config.scoring.poll_interval_ms);
}
