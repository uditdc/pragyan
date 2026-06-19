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
import type {
  Citation,
  Dossier,
  Entity,
  EventKind,
  Insight,
  InsightStatus,
  Lead,
  Report,
  Topic,
} from "../shared/kb.ts";
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
      CREATE TABLE IF NOT EXISTS topic_dossiers (
        topic_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL DEFAULT '',
        updated_at TEXT,
        updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'claude',
        topic_id INTEGER,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        opinion TEXT NOT NULL DEFAULT '',
        citations TEXT NOT NULL DEFAULT '[]',
        model TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
      CREATE TABLE IF NOT EXISTS insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER,
        topic_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        source_refs TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        approved_at TEXT,
        rejected_at TEXT,
        acted_at TEXT,
        action_result TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status, created_at);
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note TEXT NOT NULL,
        topic_id INTEGER,
        created_at TEXT NOT NULL,
        consumed_at TEXT
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
  if (config.feed.max_age_hours > 0) {
    where.push("created_at > @max_age_cutoff");
    params.max_age_cutoff = new Date(
      Date.now() - config.feed.max_age_hours * 3_600_000,
    ).toISOString();
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

interface ReportRow {
  id: number;
  created_at: string;
  author: string;
  topic_id: number | null;
  title: string;
  body: string;
  opinion: string;
  citations: string;
  model: string | null;
}
function rowToReport(r: ReportRow): Report {
  return { ...r, citations: JSON.parse(r.citations) as Citation[] };
}
const insertReportStmt = db.prepare(`
  INSERT INTO reports (created_at, author, topic_id, title, body, opinion, citations, model)
  VALUES (@created_at, @author, @topic_id, @title, @body, @opinion, @citations, @model)
`);
const getReportStmt = db.prepare<[number], ReportRow>("SELECT * FROM reports WHERE id = ?");

export interface NewReport {
  created_at: string;
  author: string;
  topic_id: number | null;
  title: string;
  body: string;
  opinion: string;
  citations: Citation[];
  model: string | null;
}
export function insertReport(r: NewReport): Report {
  const info = insertReportStmt.run({ ...r, citations: JSON.stringify(r.citations) });
  return rowToReport(getReportStmt.get(Number(info.lastInsertRowid))!);
}
export function getReport(id: number): Report | null {
  const row = getReportStmt.get(id);
  return row ? rowToReport(row) : null;
}
const reportsStmt = db.prepare<[number], ReportRow>(
  "SELECT * FROM reports ORDER BY created_at DESC, id DESC LIMIT ?",
);
export function listReports(limit: number): Report[] {
  return reportsStmt.all(limit).map(rowToReport);
}

interface InsightRow {
  id: number;
  report_id: number | null;
  topic_id: number | null;
  status: string;
  title: string;
  body: string;
  rationale: string;
  source_refs: string;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  acted_at: string | null;
  action_result: string | null;
}
function rowToInsight(r: InsightRow): Insight {
  return {
    ...r,
    status: r.status as InsightStatus,
    source_refs: JSON.parse(r.source_refs) as string[],
  };
}
const insertInsightStmt = db.prepare(`
  INSERT INTO insights (report_id, topic_id, status, title, body, rationale, source_refs, created_at)
  VALUES (@report_id, @topic_id, 'pending', @title, @body, @rationale, @source_refs, @created_at)
`);
const getInsightStmt = db.prepare<[number], InsightRow>("SELECT * FROM insights WHERE id = ?");

export interface NewInsight {
  report_id: number | null;
  topic_id: number | null;
  title: string;
  body: string;
  rationale: string;
  source_refs: string[];
  created_at: string;
}
export function insertInsight(i: NewInsight): Insight {
  const info = insertInsightStmt.run({ ...i, source_refs: JSON.stringify(i.source_refs) });
  return rowToInsight(getInsightStmt.get(Number(info.lastInsertRowid))!);
}
export function getInsight(id: number): Insight | null {
  const row = getInsightStmt.get(id);
  return row ? rowToInsight(row) : null;
}
const insightsByStatusStmt = db.prepare<[string, number], InsightRow>(
  "SELECT * FROM insights WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?",
);
const insightsAllStmt = db.prepare<[number], InsightRow>(
  "SELECT * FROM insights ORDER BY created_at DESC, id DESC LIMIT ?",
);
export function listInsights(status: InsightStatus | null, limit: number): Insight[] {
  const rows = status ? insightsByStatusStmt.all(status, limit) : insightsAllStmt.all(limit);
  return rows.map(rowToInsight);
}
const setInsightStatusStmt = db.prepare(`
  UPDATE insights SET
    status = @status,
    approved_at = CASE WHEN @status = 'approved' THEN @now ELSE approved_at END,
    rejected_at = CASE WHEN @status = 'rejected' THEN @now ELSE rejected_at END,
    acted_at = CASE WHEN @status = 'acted' THEN @now ELSE acted_at END,
    action_result = COALESCE(@action_result, action_result)
  WHERE id = @id
`);
export function setInsightStatus(
  id: number,
  status: InsightStatus,
  now: string,
  action_result: string | null = null,
): Insight | null {
  setInsightStatusStmt.run({ id, status, now, action_result });
  return getInsight(id);
}

const insertLeadStmt = db.prepare(
  "INSERT INTO leads (note, topic_id, created_at) VALUES (@note, @topic_id, @created_at)",
);
export function insertLead(note: string, topic_id: number | null, created_at: string): void {
  insertLeadStmt.run({ note, topic_id, created_at });
}
const leadsStmt = db.prepare<[number], Lead>(
  "SELECT * FROM leads WHERE consumed_at IS NULL ORDER BY created_at DESC LIMIT ?",
);
export function listLeads(limit: number): Lead[] {
  return leadsStmt.all(limit);
}

const getDossierStmt = db.prepare<[number], Dossier>("SELECT * FROM topic_dossiers WHERE topic_id = ?");
export function getDossier(topicId: number): Dossier | null {
  return getDossierStmt.get(topicId) ?? null;
}
const upsertDossierStmt = db.prepare(`
  INSERT INTO topic_dossiers (topic_id, state, updated_at, updated_by)
  VALUES (@topic_id, @state, @now, @updated_by)
  ON CONFLICT(topic_id) DO UPDATE SET state = @state, updated_at = @now, updated_by = @updated_by
`);
export function upsertDossier(topicId: number, state: string, updatedBy: string, now: string): void {
  upsertDossierStmt.run({ topic_id: topicId, state, now, updated_by: updatedBy });
}

export interface EventRef {
  post_id?: string | null;
  topic_id?: number | null;
  insight_id?: number | null;
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
  insight_id: number | null;
  entity_id: number | null;
  created_at: string;
}
const eventsSinceStmt = db.prepare<[string, number], EventRow>(
  "SELECT kind, post_id, topic_id, insight_id, entity_id, created_at FROM events WHERE created_at > ? ORDER BY created_at ASC LIMIT ?",
);
export function getEventsSince(since: string, limit: number): EventRow[] {
  return eventsSinceStmt.all(since, limit);
}

seedTopics(config.interest_topics);
