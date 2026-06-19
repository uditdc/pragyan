import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import type {
  AuthorProfile,
  FeedSort,
  HarvestedPost,
  MediaType,
  MetricSnapshot,
  Post,
  Scores,
} from "../shared/post.ts";
import { engagementOf, SCHEMA_VERSION } from "../shared/post.ts";
import type { Digest, SummaryRecord, SummaryStatus } from "../shared/summary.ts";
import type { Entity, EventKind, Topic } from "../shared/kb.ts";
import { config } from "./config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configuredPath = process.env.XFEED_DB_PATH ?? config.server.db_path;
const dbPath =
  configuredPath === ":memory:" || isAbsolute(configuredPath)
    ? configuredPath
    : join(repoRoot, configuredPath);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

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
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

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

  CREATE TABLE IF NOT EXISTS post_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    replies INTEGER NOT NULL,
    reposts INTEGER NOT NULL,
    likes INTEGER NOT NULL,
    views INTEGER NOT NULL,
    engagement INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_post_metrics ON post_metrics(post_id, observed_at);

  CREATE TABLE IF NOT EXISTS post_seen (
    post_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    feed_position INTEGER,
    PRIMARY KEY (post_id, observed_at)
  );

  CREATE TABLE IF NOT EXISTS authors (
    handle TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    post_count INTEGER NOT NULL DEFAULT 0,
    kept_count INTEGER NOT NULL DEFAULT 0
  );
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

// Ordered, idempotent schema migrations gated by PRAGMA user_version. The legacy
// posts/summaries/post_metrics/post_seen/authors tables above are the v0 baseline;
// each migration below bumps the version once.
const migrations: Array<() => void> = [
  () =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT UNIQUE NOT NULL,
        priority REAL NOT NULL DEFAULT 0,
        relevance REAL NOT NULL DEFAULT 0,
        last_ranked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(kind, name)
      );
      CREATE TABLE IF NOT EXISTS mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL,
        post_id TEXT,
        report_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id, created_at);
      CREATE TABLE IF NOT EXISTS post_topics (
        post_id TEXT NOT NULL,
        topic_id INTEGER NOT NULL,
        PRIMARY KEY (post_id, topic_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        post_id TEXT,
        topic_id INTEGER,
        insight_id INTEGER,
        entity_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `),
  () =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        params TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
    `),
];

let userVersion = db.pragma("user_version", { simple: true }) as number;
for (; userVersion < migrations.length; userVersion++) migrations[userVersion]();
db.pragma(`user_version = ${migrations.length}`);

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

const unscoredStmt = db.prepare<[number], Row>(
  "SELECT * FROM posts WHERE kept = 1 AND scored_at IS NULL ORDER BY harvested_at DESC LIMIT ?",
);

export function getUnscoredPosts(limit: number): Post[] {
  return unscoredStmt.all(limit).map(rowToPost);
}

const updateScoresStmt = db.prepare(`
  UPDATE posts SET
    s_relevance = @s_relevance,
    s_importance = @s_importance,
    s_clickbait = @s_clickbait,
    s_is_news = @s_is_news,
    s_news_confidence = @s_news_confidence,
    scored_at = @scored_at
  WHERE id = @id AND scored_at IS NULL
`);

export interface ScoreUpdate {
  id: string;
  scores: Scores;
  scored_at: string;
}

const updateScoresTx = db.transaction((updates: ScoreUpdate[]) => {
  for (const u of updates) {
    updateScoresStmt.run({
      id: u.id,
      s_relevance: u.scores.relevance,
      s_importance: u.scores.importance,
      s_clickbait: u.scores.clickbait,
      s_is_news: u.scores.is_news ? 1 : 0,
      s_news_confidence: u.scores.news_confidence,
      scored_at: u.scored_at,
    });
  }
});

export function updatePostScores(updates: ScoreUpdate[]): void {
  updateScoresTx(updates);
}

const latestMetricStmt = db.prepare<
  [string],
  { replies: number; reposts: number; likes: number; views: number }
>(
  "SELECT replies, reposts, likes, views FROM post_metrics WHERE post_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
);

const insertMetricStmt = db.prepare(`
  INSERT INTO post_metrics (post_id, observed_at, replies, reposts, likes, views, engagement)
  VALUES (@post_id, @observed_at, @replies, @reposts, @likes, @views, @engagement)
`);

const insertSeenStmt = db.prepare(
  "INSERT OR IGNORE INTO post_seen (post_id, observed_at, feed_position) VALUES (@post_id, @observed_at, @feed_position)",
);

const upsertAuthorStmt = db.prepare(`
  INSERT INTO authors (handle, name, source, first_seen, last_seen, post_count, kept_count)
  VALUES (@handle, @name, @source, @now, @now, 1, @kept)
  ON CONFLICT(handle) DO UPDATE SET
    name = excluded.name,
    last_seen = excluded.last_seen,
    post_count = post_count + 1,
    kept_count = kept_count + @kept
`);

export interface Observation {
  post: HarvestedPost;
  kept: boolean;
  observed_at: string;
  feed_position: number | null;
}

const recordObservationTx = db.transaction((o: Observation) => {
  const m = o.post.metrics;
  const last = latestMetricStmt.get(o.post.id);
  const changed =
    !last ||
    last.replies !== m.replies ||
    last.reposts !== m.reposts ||
    last.likes !== m.likes ||
    last.views !== m.views;
  if (changed) {
    insertMetricStmt.run({
      post_id: o.post.id,
      observed_at: o.observed_at,
      replies: m.replies,
      reposts: m.reposts,
      likes: m.likes,
      views: m.views,
      engagement: engagementOf(m),
    });
  }
  insertSeenStmt.run({
    post_id: o.post.id,
    observed_at: o.observed_at,
    feed_position: o.feed_position,
  });
  upsertAuthorStmt.run({
    handle: o.post.author_handle,
    name: o.post.author_name,
    source: o.post.source,
    now: o.observed_at,
    kept: o.kept ? 1 : 0,
  });
});

export function recordObservation(o: Observation): void {
  recordObservationTx(o);
}

const metricsHistStmt = db.prepare<[string], MetricSnapshot>(
  "SELECT observed_at, replies, reposts, likes, views, engagement FROM post_metrics WHERE post_id = ? ORDER BY observed_at ASC, id ASC",
);

export function getPostMetricsHistory(postId: string): MetricSnapshot[] {
  return metricsHistStmt.all(postId);
}

export function getPostVelocity(postId: string): number | null {
  const h = metricsHistStmt.all(postId);
  if (h.length < 2) return null;
  const first = h[0];
  const last = h[h.length - 1];
  const hours = (Date.parse(last.observed_at) - Date.parse(first.observed_at)) / 3_600_000;
  if (hours <= 0) return null;
  return (last.engagement - first.engagement) / hours;
}

const seenStmt = db.prepare<[string], { observed_at: string; feed_position: number | null }>(
  "SELECT observed_at, feed_position FROM post_seen WHERE post_id = ? ORDER BY observed_at ASC",
);

export function getPostSeen(postId: string): { observed_at: string; feed_position: number | null }[] {
  return seenStmt.all(postId);
}

const authorStmt = db.prepare<[string], AuthorProfile>("SELECT * FROM authors WHERE handle = ?");

export function getAuthor(handle: string): AuthorProfile | null {
  return authorStmt.get(handle) ?? null;
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
  const changed = runOverIds(dismissStmt, ids, { now });
  for (const id of ids) recordEvent("dismiss", { post_id: id }, now);
  return changed;
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

// Mild recency decay applied only to score-sorted ordering (not to the min_score
// gate, so thresholds keep their meaning): a post ~3 days old ranks at ~half.
const RECENCY_DECAY_SQL =
  "(1.0 / (1.0 + ((julianday('now') - julianday(created_at)) * 24.0) / 72.0))";

function compositeScoreSql(): string {
  const { weights } = config;
  return `(
    COALESCE(s_importance, 0) * ${weights.importance}
    + COALESCE(s_relevance, 0) * ${weights.relevance}
    - COALESCE(s_clickbait, 0) * ${weights.clickbait}
  )`;
}

export function queryFeed(q: FeedQuery): FeedResult {
  const composite = compositeScoreSql();

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
  if (config.feed.max_age_hours > 0) {
    where.push("created_at > @max_age_cutoff");
    params.max_age_cutoff = new Date(
      Date.now() - config.feed.max_age_hours * 3_600_000,
    ).toISOString();
  }
  if (q.news_only) {
    where.push("s_is_news = 1");
    where.push(`COALESCE(s_news_confidence, 0) >= ${config.gates.min_news_confidence}`);
  }
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
      : `scored_at IS NULL, ${composite} * ${RECENCY_DECAY_SQL} DESC, harvested_at DESC`;
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
  const composite = compositeScoreSql();

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
  if (q.news_only) {
    where.push("s_is_news = 1");
    where.push(`COALESCE(s_news_confidence, 0) >= ${config.gates.min_news_confidence}`);
  }
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

// ── Knowledge base (topics, entities, reports, insights, leads, events) ──

const seedTopicStmt = db.prepare("INSERT OR IGNORE INTO topics (label, created_at) VALUES (?, ?)");

export function seedTopics(labels: string[]): void {
  const now = new Date().toISOString();
  const tx = db.transaction((ls: string[]) => {
    for (const l of ls) seedTopicStmt.run(l, now);
  });
  tx(labels);
}

const topicsStmt = db.prepare<[], Topic>("SELECT * FROM topics ORDER BY priority DESC, label ASC");
export function listTopics(): Topic[] {
  return topicsStmt.all();
}

const topicByLabelStmt = db.prepare<[string], Topic>("SELECT * FROM topics WHERE label = ?");
export function getTopicByLabel(label: string): Topic | null {
  return topicByLabelStmt.get(label) ?? null;
}

const setTopicRankStmt = db.prepare(
  "UPDATE topics SET priority = @priority, relevance = @relevance, last_ranked_at = @now WHERE id = @id",
);
export function setTopicRanking(id: number, priority: number, relevance: number, now: string): void {
  setTopicRankStmt.run({ id, priority, relevance, now });
}

const entityUpsertStmt = db.prepare(`
  INSERT INTO entities (kind, name, aliases, first_seen, last_seen, mention_count)
  VALUES (@kind, @name, '[]', @now, @now, 1)
  ON CONFLICT(kind, name) DO UPDATE SET last_seen = @now, mention_count = mention_count + 1
`);
const entityIdStmt = db.prepare<[string, string], { id: number }>(
  "SELECT id FROM entities WHERE kind = ? AND name = ?",
);
const insertMentionStmt = db.prepare(
  "INSERT INTO mentions (entity_id, post_id, report_id, created_at) VALUES (@entity_id, @post_id, @report_id, @created_at)",
);

const recordMentionTx = db.transaction(
  (kind: string, name: string, ref: { post_id?: string; report_id?: number }, now: string) => {
    entityUpsertStmt.run({ kind, name, now });
    const row = entityIdStmt.get(kind, name)!;
    insertMentionStmt.run({
      entity_id: row.id,
      post_id: ref.post_id ?? null,
      report_id: ref.report_id ?? null,
      created_at: now,
    });
    return row.id;
  },
);

export function recordEntityMention(
  kind: string,
  name: string,
  ref: { post_id?: string; report_id?: number },
  now: string,
): number {
  return recordMentionTx(kind, name, ref, now);
}

interface EntityRow {
  id: number;
  kind: string;
  name: string;
  aliases: string;
  first_seen: string;
  last_seen: string;
  mention_count: number;
}
function rowToEntity(r: EntityRow): Entity {
  return { ...r, aliases: JSON.parse(r.aliases) as string[] };
}
const entitiesStmt = db.prepare<[number], EntityRow>(
  "SELECT * FROM entities ORDER BY mention_count DESC, last_seen DESC LIMIT ?",
);
export function listEntities(limit: number): Entity[] {
  return entitiesStmt.all(limit).map(rowToEntity);
}

const linkPostTopicStmt = db.prepare(
  "INSERT OR IGNORE INTO post_topics (post_id, topic_id) VALUES (?, ?)",
);
export function linkPostTopic(postId: string, topicId: number): void {
  linkPostTopicStmt.run(postId, topicId);
}

export interface EventRef {
  post_id?: string | null;
  topic_id?: number | null;
  insight_id?: string | number | null;
  entity_id?: number | null;
}
const insertEventStmt = db.prepare(`
  INSERT INTO events (kind, post_id, topic_id, insight_id, entity_id, created_at)
  VALUES (@kind, @post_id, @topic_id, @insight_id, @entity_id, @created_at)
`);
export function recordEvent(kind: EventKind, ref: EventRef, now: string): void {
  insertEventStmt.run({
    kind,
    post_id: ref.post_id ?? null,
    topic_id: ref.topic_id ?? null,
    insight_id: ref.insight_id ?? null,
    entity_id: ref.entity_id ?? null,
    created_at: now,
  });
}

interface EventRow {
  kind: string;
  post_id: string | null;
  topic_id: number | null;
  insight_id: string | number | null;
  entity_id: number | null;
  created_at: string;
}
const eventsSinceStmt = db.prepare<[string, number], EventRow>(
  "SELECT kind, post_id, topic_id, insight_id, entity_id, created_at FROM events WHERE created_at > ? ORDER BY created_at ASC LIMIT ?",
);
export function getEventsSince(since: string, limit: number): EventRow[] {
  return eventsSinceStmt.all(since, limit);
}

const postByIdStmt = db.prepare<[string], Row>("SELECT * FROM posts WHERE id = ?");
export function getPostById(id: string): Post | null {
  const row = postByIdStmt.get(id);
  return row ? rowToPost(row) : null;
}

// Ranks the configured topics by recent scored-post volume weighted by relevance,
// persists the ranking, and returns it (drives the agent's get_top_topics tool).
const topicVolStmt = db.prepare<{ label: string; cutoff: string }, { n: number; rel: number | null }>(
  `SELECT COUNT(*) AS n, AVG(s_relevance) AS rel FROM posts
   WHERE kept = 1 AND scored_at IS NOT NULL AND harvested_at > @cutoff AND text LIKE @label`,
);
export function getTopTopics(limit: number): Array<Topic & { volume: number; avg_relevance: number }> {
  const cutoff = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const now = new Date().toISOString();
  const ranked = listTopics()
    .map((t) => {
      const row = topicVolStmt.get({ label: `%${t.label}%`, cutoff });
      const volume = row?.n ?? 0;
      const avg = row?.rel ?? 0;
      const priority = volume * (0.5 + avg);
      return { ...t, volume, avg_relevance: avg, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
  for (const t of ranked) setTopicRanking(t.id, t.priority, t.avg_relevance, now);
  return ranked;
}

// Posts gaining engagement fastest — the "what's moving" signal only an always-on
// sensor can produce. Candidates are posts with >=2 metric snapshots in the window.
const trendingCandidatesStmt = db.prepare<[string], { post_id: string }>(
  "SELECT post_id FROM post_metrics WHERE observed_at > ? GROUP BY post_id HAVING COUNT(*) >= 2",
);
export function getTrending(limit: number): Array<{ post: Post; velocity: number }> {
  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const out: Array<{ post: Post; velocity: number }> = [];
  for (const { post_id } of trendingCandidatesStmt.all(cutoff)) {
    const velocity = getPostVelocity(post_id);
    if (velocity === null) continue;
    const post = getPostById(post_id);
    if (post) out.push({ post, velocity });
  }
  out.sort((a, b) => b.velocity - a.velocity);
  return out.slice(0, limit);
}

const scoredSinceStmt = db.prepare<[string], { n: number }>(
  "SELECT COUNT(*) AS n FROM posts WHERE scored_at > ?",
);
const newEntitiesStmt = db.prepare<[string], EntityRow>(
  "SELECT * FROM entities WHERE first_seen > ? ORDER BY mention_count DESC LIMIT 20",
);
export function getChanges(since: string): {
  posts_scored_since: number;
  new_entities: Entity[];
  events: ReturnType<typeof getEventsSince>;
} {
  return {
    posts_scored_since: scoredSinceStmt.get(since)?.n ?? 0,
    new_entities: newEntitiesStmt.all(since).map(rowToEntity),
    events: getEventsSince(since, 100),
  };
}

interface JobRow {
  id: number;
  kind: string;
  params: string;
  status: string;
  result: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface Job {
  id: number;
  kind: string;
  params: unknown;
  status: string;
  result: string | null;
  created_at: string;
  finished_at: string | null;
}
function rowToJob(r: JobRow): Job {
  let params: unknown = r.params;
  try {
    params = JSON.parse(r.params);
  } catch {
    /* leave as string */
  }
  return { ...r, params };
}
const insertJobStmt = db.prepare(
  "INSERT INTO jobs (kind, params, status, created_at) VALUES (@kind, @params, 'pending', @now)",
);
const jobByIdStmt = db.prepare<[number], JobRow>("SELECT * FROM jobs WHERE id = ?");
const finishJobStmt = db.prepare(
  "UPDATE jobs SET status = @status, result = @result, finished_at = @now WHERE id = @id",
);
export function createJob(kind: string, params: unknown, now: string): Job {
  const info = insertJobStmt.run({ kind, params: JSON.stringify(params), now });
  return rowToJob(jobByIdStmt.get(Number(info.lastInsertRowid))!);
}
export function getJob(id: number): Job | null {
  const row = jobByIdStmt.get(id);
  return row ? rowToJob(row) : null;
}
export function finishJob(id: number, status: string, result: string, now: string): void {
  finishJobStmt.run({ id, status, result, now });
}

// Tiered retention: prune only dropped firehose noise (kept = 0) older than the
// cutoff. Kept posts — and their longitudinal metric/seen history, the moat — are
// preserved indefinitely. Orphaned metric/seen rows for pruned posts are swept.
const prunePostsStmt = db.prepare("DELETE FROM posts WHERE kept = 0 AND harvested_at < ?");
const pruneOrphanMetricsStmt = db.prepare(
  "DELETE FROM post_metrics WHERE post_id NOT IN (SELECT id FROM posts)",
);
const pruneOrphanSeenStmt = db.prepare(
  "DELETE FROM post_seen WHERE post_id NOT IN (SELECT id FROM posts)",
);
const prunePostsTx = db.transaction((cutoff: string) => {
  const n = prunePostsStmt.run(cutoff).changes;
  pruneOrphanMetricsStmt.run();
  pruneOrphanSeenStmt.run();
  return n;
});
export function prunePosts(dropRetentionDays: number): number {
  const cutoff = new Date(Date.now() - dropRetentionDays * 86_400_000).toISOString();
  return prunePostsTx(cutoff);
}

seedTopics(config.interest_topics);
