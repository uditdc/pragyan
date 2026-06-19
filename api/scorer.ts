import type { Post, Scores } from "../shared/post.ts";
import { engagementOf } from "../shared/post.ts";
import { config } from "./config.ts";
import { llmEnabled } from "./llm.ts";
import { callLLM } from "./budget.ts";
import { dummyScore } from "./dummyScorer.ts";
import { getUnscoredPosts, updatePostScores, recordEntityMention, type ScoreUpdate } from "./db.ts";

// Cheap triage tier: coarse topic-relevance so the brain (Claude) sees the
// high-signal slice, not the firehose. It is deliberately simple. When the
// shared budget is exhausted or no LLM is configured, it falls back to the
// engagement heuristic so the queue always drains (see docs/plans/phase6.md).

const floor = config.scoring.engagement_floor_for_llm;

// News (no engagement) is low-volume and high-value, so always LLM-score it;
// the X firehose is gated by an engagement floor to bound LLM volume.
function llmEligible(p: Post): boolean {
  return p.source !== "x" || engagementOf(p.metrics) >= floor;
}

const SYSTEM_PROMPT = `You rank social and news posts for one reader. Reader interests: ${config.interest_topics.join(", ")}.
Score each post on 0..1 scales:
- relevance: topic match to the reader's interests (NOT popularity).
- importance: how consequential the post is.
- clickbait: bait / ragebait / empty hype.
Also set is_news (true for newsworthy reporting) and news_confidence (0..1).
For each post also list up to 3 salient named entities as {"name","kind"} with kind in person|org|ticker|product|place|topic|other.
Output JSON only, exactly: {"scores":[{"id","relevance","importance","clickbait","is_news","news_confidence","entities":[{"name","kind"}]}]}.
Return one entry per input id, nothing else.`;

function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function payload(posts: Post[]): string {
  return JSON.stringify(
    posts.map((p) => ({
      id: p.id,
      author: p.author_handle,
      source: p.source,
      text: p.text.slice(0, 280),
      is_repost: p.is_repost,
    })),
  );
}

export interface BatchResult {
  scores: Map<string, Scores>;
  entities: Array<{ postId: string; name: string; kind: string }>;
}

export async function scoreBatch(posts: Post[]): Promise<BatchResult> {
  const body = payload(posts);
  const est = Math.ceil((SYSTEM_PROMPT.length + body.length) / 4) + posts.length * 40;
  const res = await callLLM(
    "scorer",
    {
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
    },
    est,
  );

  let parsed: { scores?: unknown };
  try {
    parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { scores?: unknown };
  } catch {
    parsed = {};
  }

  const scores = new Map<string, Scores>();
  const entities: BatchResult["entities"] = [];
  if (Array.isArray(parsed.scores)) {
    for (const raw of parsed.scores as Record<string, unknown>[]) {
      const id = String(raw?.id ?? "");
      if (!id) continue;
      scores.set(id, {
        relevance: clamp01(raw.relevance),
        importance: clamp01(raw.importance),
        clickbait: clamp01(raw.clickbait),
        is_news: Boolean(raw.is_news),
        news_confidence: clamp01(raw.news_confidence),
      });
      if (Array.isArray(raw.entities)) {
        for (const e of raw.entities as Record<string, unknown>[]) {
          const name = String(e?.name ?? "").trim();
          if (name) entities.push({ postId: id, name, kind: String(e?.kind ?? "other") });
        }
      }
    }
  }
  return { scores, entities };
}

// Scores `posts`, falling back to the heuristic for any id the LLM didn't return
// (or for the whole batch on error / no budget), persists with scored_at set, and
// records any extracted entities into the graph.
export async function scoreBatchSafe(posts: Post[], now: string): Promise<void> {
  let result: BatchResult = { scores: new Map(), entities: [] };
  if (llmEnabled) {
    try {
      result = await scoreBatch(posts);
    } catch {
      result = { scores: new Map(), entities: [] };
    }
  }
  const updates: ScoreUpdate[] = posts.map((p) => ({
    id: p.id,
    scores: result.scores.get(p.id) ?? dummyScore(p, p.clickbait_heuristic),
    scored_at: now,
  }));
  updatePostScores(updates);
  for (const e of result.entities) {
    recordEntityMention(e.kind, e.name, { post_id: e.postId }, now);
  }
}

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const posts = getUnscoredPosts(config.scoring.batch_size);
    if (posts.length === 0) return;
    const now = new Date().toISOString();
    const eligible = posts.filter(llmEligible);
    const heuristic = posts.filter((p) => !llmEligible(p));
    if (heuristic.length) {
      updatePostScores(
        heuristic.map((p) => ({ id: p.id, scores: dummyScore(p, p.clickbait_heuristic), scored_at: now })),
      );
    }
    if (eligible.length) await scoreBatchSafe(eligible, now);
  } catch (err) {
    console.error("scorer tick failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startScorer(): void {
  if (!llmEnabled) {
    console.warn("LLM disabled — scorer uses the engagement heuristic fallback.");
  }
  setInterval(() => void tick(), config.scoring.poll_interval_ms);
}
