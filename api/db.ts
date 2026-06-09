import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import type {
  FeedSort,
  HarvestedPost,
  MediaType,
  Post,
  Scores,
} from "../shared/post.ts";
import { SCHEMA_VERSION } from "../shared/post.ts";
import type { Digest, SummaryRecord, SummaryStatus } from "../shared/summary.ts";
import { config } from "./config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = isAbsolute(config.server.db_path)
  ? config.server.db_path
  : join(repoRoot, config.server.db_path);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'x',
    author_handle TEXT NOT NULL,
    author_name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    url TEXT NOT NULL,
    is_repost INTEGER NOT NULL,
    is_quote INTEGER NOT NULL,
    is_reply INTEGER NOT NULL,
    is_ad INTEGER NOT NULL,
    is_thread INTEGER NOT NULL,
    thread_id TEXT,
    quoted_text TEXT,
    media_types TEXT NOT NULL,
    m_replies INTEGER NOT NULL,
    m_reposts INTEGER NOT NULL,
    m_likes INTEGER NOT NULL,
    m_views INTEGER NOT NULL,
    harvested_at TEXT NOT NULL,
    kept INTEGER NOT NULL,
    drop_reason TEXT,
    clickbait_heuristic REAL NOT NULL,
    s_relevance REAL,
    s_importance REAL,
    s_clickbait REAL,
    s_is_news INTEGER,
    s_news_confidence REAL,
    scored_at TEXT,
    viewed_at TEXT,
    expired_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_posts_harvested ON posts(harvested_at);
  CREATE INDEX IF NOT EXISTS idx_posts_scoring ON posts(kept, scored_at);

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generated_at TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    source_counts TEXT NOT NULL,
    gen_ms INTEGER,
    model TEXT,
    status TEXT NOT NULL,
    digest TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_summaries_generated ON summaries(generated_at);
`);

const existingColumns = new Set(
  db.prepare("PRAGMA table_info(posts)").all().map((c) => (c as { name: string }).name),
);
for (const [name, type] of [
  ["viewed_at", "TEXT"],
  ["expired_at", "TEXT"],
  ["source", "TEXT NOT NULL DEFAULT 'x'"],
] as const) {
  if (!existingColumns.has(name)) {
    db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
  }
}

db.exec(
  "CREATE INDEX IF NOT EXISTS idx_posts_lifecycle ON posts(expired_at, viewed_at, harvested_at)",
);

interface Row {
  id: string;
  schema_version: number;
  source: string;
  author_handle: string;
  author_name: string;
  text: string;
  created_at: string;
  url: string;
  is_repost: number;
  is_quote: number;
  is_reply: number;
  is_ad: number;
  is_thread: number;
  thread_id: string | null;
  quoted_text: string | null;
  media_types: string;
  m_replies: number;
  m_reposts: number;
  m_likes: number;
  m_views: number;
  harvested_at: string;
  kept: number;
  drop_reason: string | null;
  clickbait_heuristic: number;
  s_relevance: number | null;
  s_importance: number | null;
  s_clickbait: number | null;
  s_is_news: number | null;
  s_news_confidence: number | null;
  scored_at: string | null;
  viewed_at: string | null;
  expired_at: string | null;
}

function rowToPost(r: Row): Post {
  const scores: Scores | null =
    r.scored_at === null
      ? null
      : {
          relevance: r.s_relevance!,
          importance: r.s_importance!,
          clickbait: r.s_clickbait!,
          is_news: r.s_is_news === 1,
          news_confidence: r.s_news_confidence!,
        };

  return {
    schema_version: r.schema_version,
    id: r.id,
    source: r.source as Post["source"],
    author_handle: r.author_handle,
    author_name: r.author_name,
    text: r.text,
    created_at: r.created_at,
    url: r.url,
    is_repost: r.is_repost === 1,
    is_quote: r.is_quote === 1,
    is_reply: r.is_reply === 1,
    is_ad: r.is_ad === 1,
    is_thread: r.is_thread === 1,
    thread_id: r.thread_id,
    quoted_text: r.quoted_text,
    media_types: JSON.parse(r.media_types) as MediaType[],
    metrics: {
      replies: r.m_replies,
      reposts: r.m_reposts,
      likes: r.m_likes,
      views: r.m_views,
    },
    harvested_at: r.harvested_at,
    kept: r.kept === 1,
    drop_reason: r.drop_reason as Post["drop_reason"],
    clickbait_heuristic: r.clickbait_heuristic,
    scores,
    scored_at: r.scored_at,
    viewed_at: r.viewed_at,
    expired_at: r.expired_at,
  };
}

const existsStmt = db.prepare<[string], { id: string }>(
  "SELECT id FROM posts WHERE id = ?",
);

const upsertStmt = db.prepare(`
  INSERT INTO posts (
    id, schema_version, source, author_handle, author_name, text, created_at, url,
    is_repost, is_quote, is_reply, is_ad, is_thread, thread_id, quoted_text,
    media_types, m_replies, m_reposts, m_likes, m_views, harvested_at,
    kept, drop_reason, clickbait_heuristic,
    s_relevance, s_importance, s_clickbait, s_is_news, s_news_confidence, scored_at,
    viewed_at, expired_at
  ) VALUES (
    @id, @schema_version, @source, @author_handle, @author_name, @text, @created_at, @url,
    @is_repost, @is_quote, @is_reply, @is_ad, @is_thread, @thread_id, @quoted_text,
    @media_types, @m_replies, @m_reposts, @m_likes, @m_views, @harvested_at,
    @kept, @drop_reason, @clickbait_heuristic,
    @s_relevance, @s_importance, @s_clickbait, @s_is_news, @s_news_confidence, @scored_at,
    @viewed_at, @expired_at
  )
  ON CONFLICT(id) DO UPDATE SET
    m_replies = excluded.m_replies,
    m_reposts = excluded.m_reposts,
    m_likes = excluded.m_likes,
    m_views = excluded.m_views,
    harvested_at = excluded.harvested_at
`);

export interface StoredPost {
  post: HarvestedPost;
  kept: boolean;
  drop_reason: Post["drop_reason"];
  clickbait_heuristic: number;
  scores: Scores | null;
  scored_at: string | null;
}

export function postExists(id: string): boolean {
  return existsStmt.get(id) !== undefined;
}

export function upsertPost(s: StoredPost): void {
  const p = s.post;
  upsertStmt.run({
    id: p.id,
    schema_version: SCHEMA_VERSION,
    source: p.source,
    author_handle: p.author_handle,
    author_name: p.author_name,
    text: p.text,
    created_at: p.created_at,
    url: p.url,
    is_repost: p.is_repost ? 1 : 0,
    is_quote: p.is_quote ? 1 : 0,
    is_reply: p.is_reply ? 1 : 0,
    is_ad: p.is_ad ? 1 : 0,
    is_thread: p.is_thread ? 1 : 0,
    thread_id: p.thread_id,
    quoted_text: p.quoted_text,
    media_types: JSON.stringify(p.media_types),
    m_replies: p.metrics.replies,
    m_reposts: p.metrics.reposts,
    m_likes: p.metrics.likes,
    m_views: p.metrics.views,
    harvested_at: p.harvested_at,
    kept: s.kept ? 1 : 0,
    drop_reason: s.drop_reason,
    clickbait_heuristic: s.clickbait_heuristic,
    s_relevance: s.scores?.relevance ?? null,
    s_importance: s.scores?.importance ?? null,
    s_clickbait: s.scores?.clickbait ?? null,
    s_is_news: s.scores ? (s.scores.is_news ? 1 : 0) : null,
    s_news_confidence: s.scores?.news_confidence ?? null,
    scored_at: s.scored_at,
    viewed_at: null,
    expired_at: null,
  });
}

const markViewedStmt = db.prepare(
  "UPDATE posts SET viewed_at = @now WHERE id = @id AND viewed_at IS NULL",
);
const dismissStmt = db.prepare("UPDATE posts SET expired_at = @now WHERE id = @id");
const undismissStmt = db.prepare("UPDATE posts SET expired_at = NULL WHERE id = @id");

function runOverIds(
  stmt: Database.Statement,
  ids: string[],
  extra: Record<string, unknown>,
): number {
  let changes = 0;
  const tx = db.transaction((list: string[]) => {
    for (const id of list) changes += stmt.run({ id, ...extra }).changes;
  });
  tx(ids);
  return changes;
}

export function markViewed(ids: string[], now: string): number {
  return runOverIds(markViewedStmt, ids, { now });
}

export function dismiss(ids: string[], now: string): number {
  return runOverIds(dismissStmt, ids, { now });
}

export function undismiss(ids: string[]): number {
  return runOverIds(undismissStmt, ids, {});
}

export interface FeedQuery {
  min_score: number;
  since: string | null;
  limit: number;
  news_only: boolean;
  include_dropped: boolean;
  include_expired: boolean;
  sort: FeedSort;
}

export interface FeedResult {
  posts: Post[];
  next_since: string | null;
}

export function queryFeed(q: FeedQuery): FeedResult {
  const { weights } = config;
  const composite = `(
    COALESCE(s_importance, 0) * ${weights.importance}
    + COALESCE(s_relevance, 0) * ${weights.relevance}
    - COALESCE(s_clickbait, 0) * ${weights.clickbait}
  )`;

  const where: string[] = [];
  const params: Record<string, unknown> = { limit: q.limit };

  if (!q.include_dropped) where.push("kept = 1");
  if (!q.include_expired) {
    const nowMs = Date.now();
    const { viewed_ttl_min, unviewed_ttl_hours } = config.expiry;
    where.push("expired_at IS NULL");
    where.push("harvested_at > @unviewed_cutoff");
    where.push("(viewed_at IS NULL OR viewed_at > @viewed_cutoff)");
    params.unviewed_cutoff = new Date(nowMs - unviewed_ttl_hours * 3_600_000).toISOString();
    params.viewed_cutoff = new Date(nowMs - viewed_ttl_min * 60_000).toISOString();
  }
  if (q.news_only) where.push("s_is_news = 1");
  if (q.since !== null) {
    where.push("harvested_at > @since");
    params.since = q.since;
  }
  if (q.min_score > 0) {
    where.push("scored_at IS NOT NULL");
    where.push(`${composite} >= @min_score`);
    params.min_score = q.min_score;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    q.sort === "recent"
      ? "created_at DESC, harvested_at DESC"
      : `scored_at IS NULL, ${composite} DESC, harvested_at DESC`;
  const rows = db
    .prepare<Record<string, unknown>, Row>(
      `SELECT * FROM posts ${whereSql}
       ORDER BY ${orderSql}
       LIMIT @limit`,
    )
    .all(params);

  const posts = rows.map(rowToPost);
  const next_since = posts.reduce<string | null>(
    (max, p) => (max === null || p.harvested_at > max ? p.harvested_at : max),
    q.since,
  );

  return { posts, next_since };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface PostSearchQuery {
  text: string | null;
  author: string | null;
  news_only: boolean;
  since: string | null;
  min_score: number;
  limit: number;
  include_expired: boolean;
}

export function searchPosts(q: PostSearchQuery): Post[] {
  const { weights } = config;
  const composite = `(
    COALESCE(s_importance, 0) * ${weights.importance}
    + COALESCE(s_relevance, 0) * ${weights.relevance}
    - COALESCE(s_clickbait, 0) * ${weights.clickbait}
  )`;

  const where: string[] = ["kept = 1"];
  const params: Record<string, unknown> = { limit: q.limit };

  if (!q.include_expired) {
    const nowMs = Date.now();
    const { viewed_ttl_min, unviewed_ttl_hours } = config.expiry;
    where.push("expired_at IS NULL");
    where.push("harvested_at > @unviewed_cutoff");
    where.push("(viewed_at IS NULL OR viewed_at > @viewed_cutoff)");
    params.unviewed_cutoff = new Date(nowMs - unviewed_ttl_hours * 3_600_000).toISOString();
    params.viewed_cutoff = new Date(nowMs - viewed_ttl_min * 60_000).toISOString();
  }
  if (q.news_only) where.push("s_is_news = 1");
  if (q.since !== null) {
    where.push("harvested_at > @since");
    params.since = q.since;
  }
  if (q.min_score > 0) {
    where.push("scored_at IS NOT NULL");
    where.push(`${composite} >= @min_score`);
    params.min_score = q.min_score;
  }
  if (q.text) {
    where.push(
      "(text LIKE @text ESCAPE '\\' OR quoted_text LIKE @text ESCAPE '\\'" +
        " OR author_handle LIKE @text ESCAPE '\\' OR author_name LIKE @text ESCAPE '\\')",
    );
    params.text = `%${escapeLike(q.text)}%`;
  }
  if (q.author) {
    where.push(
      "(author_handle LIKE @author ESCAPE '\\' OR author_name LIKE @author ESCAPE '\\')",
    );
    params.author = `%${escapeLike(q.author)}%`;
  }

  const rows = db
    .prepare<Record<string, unknown>, Row>(
      `SELECT * FROM posts WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, harvested_at DESC
       LIMIT @limit`,
    )
    .all(params);
  return rows.map(rowToPost);
}

const postsSinceStmt = db.prepare<{ since: string | null; limit: number }, Row>(
  `SELECT * FROM posts
   WHERE kept = 1 AND (@since IS NULL OR harvested_at > @since)
   ORDER BY harvested_at DESC
   LIMIT @limit`,
);

export function getPostsSince(since: string | null, limit: number): Post[] {
  return postsSinceStmt.all({ since, limit }).map(rowToPost);
}

const countNewSinceStmt = db.prepare<{ since: string }, { n: number }>(
  "SELECT COUNT(*) AS n FROM posts WHERE kept = 1 AND harvested_at > @since",
);

export function countNewSince(since: string): number {
  return countNewSinceStmt.get({ since })?.n ?? 0;
}

interface SummaryRow {
  id: number;
  generated_at: string;
  window_start: string;
  window_end: string;
  item_count: number;
  source_counts: string;
  gen_ms: number | null;
  model: string | null;
  status: string;
  digest: string;
}

function rowToSummary(r: SummaryRow): SummaryRecord {
  return {
    id: r.id,
    generated_at: r.generated_at,
    window_start: r.window_start,
    window_end: r.window_end,
    item_count: r.item_count,
    source_counts: JSON.parse(r.source_counts) as SummaryRecord["source_counts"],
    gen_ms: r.gen_ms,
    model: r.model,
    status: r.status as SummaryStatus,
    digest: JSON.parse(r.digest) as Digest,
  };
}

const insertSummaryStmt = db.prepare(`
  INSERT INTO summaries (
    generated_at, window_start, window_end, item_count,
    source_counts, gen_ms, model, status, digest
  ) VALUES (
    @generated_at, @window_start, @window_end, @item_count,
    @source_counts, @gen_ms, @model, @status, @digest
  )
`);

const getSummaryStmt = db.prepare<[number], SummaryRow>(
  "SELECT * FROM summaries WHERE id = ?",
);

export interface NewSummary {
  generated_at: string;
  window_start: string;
  window_end: string;
  item_count: number;
  source_counts: SummaryRecord["source_counts"];
  gen_ms: number | null;
  model: string | null;
  status: SummaryStatus;
  digest: Digest;
}

export function insertSummary(s: NewSummary): SummaryRecord {
  const info = insertSummaryStmt.run({
    generated_at: s.generated_at,
    window_start: s.window_start,
    window_end: s.window_end,
    item_count: s.item_count,
    source_counts: JSON.stringify(s.source_counts),
    gen_ms: s.gen_ms,
    model: s.model,
    status: s.status,
    digest: JSON.stringify(s.digest),
  });
  return rowToSummary(getSummaryStmt.get(Number(info.lastInsertRowid))!);
}

const latestSummaryStmt = db.prepare<[], SummaryRow>(
  "SELECT * FROM summaries ORDER BY generated_at DESC, id DESC LIMIT 1",
);

export function getLatestSummary(): SummaryRecord | null {
  const row = latestSummaryStmt.get();
  return row ? rowToSummary(row) : null;
}

const summariesStmt = db.prepare<[number], SummaryRow>(
  "SELECT * FROM summaries ORDER BY generated_at DESC, id DESC LIMIT ?",
);

export function getSummaries(limit: number): SummaryRecord[] {
  return summariesStmt.all(limit).map(rowToSummary);
}

const searchSummariesStmt = db.prepare<{ since: string | null; limit: number }, SummaryRow>(
  `SELECT * FROM summaries
   WHERE @since IS NULL OR generated_at > @since
   ORDER BY generated_at DESC, id DESC
   LIMIT @limit`,
);

export function searchSummaries(opts: { since: string | null; limit: number }): SummaryRecord[] {
  return searchSummariesStmt.all(opts).map(rowToSummary);
}

const pruneSummariesStmt = db.prepare(
  `DELETE FROM summaries WHERE id NOT IN (
     SELECT id FROM summaries ORDER BY generated_at DESC, id DESC LIMIT @keep
   )`,
);

export function pruneSummaries(keep: number): number {
  return pruneSummariesStmt.run({ keep }).changes;
}
