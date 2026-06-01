import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import type {
  HarvestedPost,
  MediaType,
  Post,
  Scores,
} from "../shared/post.ts";
import { SCHEMA_VERSION } from "../shared/post.ts";
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
    scored_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_posts_harvested ON posts(harvested_at);
  CREATE INDEX IF NOT EXISTS idx_posts_scoring ON posts(kept, scored_at);
`);

interface Row {
  id: string;
  schema_version: number;
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
  };
}

const existsStmt = db.prepare<[string], { id: string }>(
  "SELECT id FROM posts WHERE id = ?",
);

const upsertStmt = db.prepare(`
  INSERT INTO posts (
    id, schema_version, author_handle, author_name, text, created_at, url,
    is_repost, is_quote, is_reply, is_ad, is_thread, thread_id, quoted_text,
    media_types, m_replies, m_reposts, m_likes, m_views, harvested_at,
    kept, drop_reason, clickbait_heuristic,
    s_relevance, s_importance, s_clickbait, s_is_news, s_news_confidence, scored_at
  ) VALUES (
    @id, @schema_version, @author_handle, @author_name, @text, @created_at, @url,
    @is_repost, @is_quote, @is_reply, @is_ad, @is_thread, @thread_id, @quoted_text,
    @media_types, @m_replies, @m_reposts, @m_likes, @m_views, @harvested_at,
    @kept, @drop_reason, @clickbait_heuristic,
    @s_relevance, @s_importance, @s_clickbait, @s_is_news, @s_news_confidence, @scored_at
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
  });
}

export interface FeedQuery {
  min_score: number;
  since: string | null;
  limit: number;
  news_only: boolean;
  include_dropped: boolean;
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
  const rows = db
    .prepare<Record<string, unknown>, Row>(
      `SELECT * FROM posts ${whereSql}
       ORDER BY scored_at IS NULL, ${composite} DESC, harvested_at DESC
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
