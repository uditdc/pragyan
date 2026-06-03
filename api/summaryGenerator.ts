import type { Post } from "../shared/post.ts";
import type {
  Citation,
  Digest,
  Mover,
  Sentiment,
  Theme,
  TopVoice,
} from "../shared/summary.ts";
import { EMPTY_DIGEST } from "../shared/summary.ts";
import { config } from "./config.ts";
import { client, llmEnabled, model } from "./llm.ts";
import {
  getLatestSummary,
  getPostsSince,
  insertSummary,
  pruneSummaries,
  type NewSummary,
} from "./db.ts";
import { getSnapshot } from "./markets.ts";

function sourceCounts(posts: Post[]): { x: number; news: number } {
  let news = 0;
  for (const p of posts) if (p.scores?.is_news) news++;
  return { x: posts.length - news, news };
}

function topMovers(): Mover[] {
  const snap = getSnapshot();
  return [...snap.crypto, ...snap.indices]
    .map((t) => ({ symbol: t.symbol, price: t.price, change_pct: t.change_pct }))
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 3);
}

const SYSTEM_PROMPT = `You are a terse newsroom editor producing a catch-up digest from a stream of social and news posts.
The reader missed the last stretch and wants to know what mattered, fast.
Reader interests: ${config.interest_topics.join(", ")}.

Output JSON only, matching exactly:
{
  "tldr": "2-3 sentence narrative of the window's overall shape",
  "themes": [
    { "kicker": "ONE-WORD UPPERCASE LABEL e.g. MACRO/INCIDENT/DEV/MARKET",
      "title": "short headline", "body": "1-2 sentences of synthesis",
      "citations": [{ "source": "x"|"news", "label": "handle or outlet present in the input" }] }
  ],
  "sentiment": { "pos": <int>, "neu": <int>, "neg": <int> },
  "top_voices": [{ "source": "x"|"news", "handle": "@handle or outlet", "note": "why they mattered" }]
}

Rules: 2-5 themes, ordered by importance. Bodies are 1-2 sentences, no fluff.
Cite only handles/outlets that appear in the provided posts. sentiment values are
percentages that sum to 100. 2-4 top_voices. No markdown, no commentary outside the JSON.`;

function userPayload(posts: Post[]): string {
  const items = posts.map((p) => ({
    id: p.id,
    author_handle: p.author_handle,
    author_name: p.author_name,
    text: p.text.slice(0, 280),
    is_news: Boolean(p.scores?.is_news),
    likes: p.metrics.likes,
    reposts: p.metrics.reposts,
  }));
  return JSON.stringify(items);
}

function coerceSentiment(raw: unknown): Sentiment {
  const s = (raw ?? {}) as Partial<Sentiment>;
  const pos = Math.max(0, Math.round(Number(s.pos) || 0));
  const neu = Math.max(0, Math.round(Number(s.neu) || 0));
  const neg = Math.max(0, Math.round(Number(s.neg) || 0));
  return { pos, neu, neg };
}

function coerceThemes(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((t): Theme => {
    const o = (t ?? {}) as Record<string, unknown>;
    const citations: Citation[] = Array.isArray(o.citations)
      ? (o.citations as unknown[]).slice(0, 4).map((c): Citation => {
          const co = (c ?? {}) as Record<string, unknown>;
          return {
            source: co.source === "news" ? "news" : "x",
            label: String(co.label ?? "").slice(0, 40),
          };
        })
      : [];
    return {
      kicker: String(o.kicker ?? "").slice(0, 16).toUpperCase(),
      title: String(o.title ?? "").slice(0, 80),
      body: String(o.body ?? ""),
      citations,
    };
  });
}

function coerceVoices(raw: unknown): TopVoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((v): TopVoice => {
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      source: o.source === "news" ? "news" : "x",
      handle: String(o.handle ?? "").slice(0, 32),
      note: String(o.note ?? "").slice(0, 40),
    };
  });
}

async function synthesize(posts: Post[]): Promise<Digest> {
  const res = await client!.chat.completions.create({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPayload(posts) },
    ],
  });
  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  return {
    tldr: String(raw.tldr ?? ""),
    themes: coerceThemes(raw.themes),
    movers: topMovers(),
    sentiment: coerceSentiment(raw.sentiment),
    top_voices: coerceVoices(raw.top_voices),
  };
}

let running = false;

export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const since = getLatestSummary()?.window_end ?? null;
    const posts = getPostsSince(since, config.summary.max_posts);
    if (posts.length === 0) return;

    const window_end = posts[0].harvested_at;
    const window_start = since ?? posts[posts.length - 1].harvested_at;
    const base = {
      generated_at: new Date().toISOString(),
      window_start,
      window_end,
      item_count: posts.length,
      source_counts: sourceCounts(posts),
    };

    if (!llmEnabled || posts.length < config.summary.min_items) {
      const empty: NewSummary = {
        ...base,
        gen_ms: null,
        model: null,
        status: "empty",
        digest: { ...EMPTY_DIGEST, movers: topMovers() },
      };
      insertSummary(empty);
    } else {
      const startMs = Date.now();
      const digest = await synthesize(posts);
      insertSummary({
        ...base,
        gen_ms: Date.now() - startMs,
        model,
        status: "ok",
        digest,
      });
    }
    pruneSummaries(config.summary.retention);
  } catch (err) {
    console.error("summary tick failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startSummary(): void {
  void tick();
}
