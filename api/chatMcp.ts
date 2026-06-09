import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Post } from "../shared/post.ts";
import type { SummaryRecord } from "../shared/summary.ts";
import {
  searchPosts,
  searchSummaries,
  getLatestSummary,
  type PostSearchQuery,
} from "./db.ts";

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function sinceFrom(hours: unknown): string | null {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function projectPost(p: Post) {
  return {
    id: p.id,
    author_handle: p.author_handle,
    author_name: p.author_name,
    text: p.text.slice(0, 280),
    url: p.url,
    created_at: p.created_at,
    is_news: Boolean(p.scores?.is_news),
    likes: p.metrics.likes,
    reposts: p.metrics.reposts,
  };
}

function projectSummary(s: SummaryRecord) {
  return {
    generated_at: s.generated_at,
    window_start: s.window_start,
    window_end: s.window_end,
    tldr: s.digest.tldr,
    themes: s.digest.themes.map((t) => ({ kicker: t.kicker, title: t.title, body: t.body })),
  };
}

const tools = [
  {
    name: "search_feed",
    description:
      "Search the reader's feed posts by keyword and/or author. Returns matching posts, most recent first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Keyword(s) to match in post text or author." },
        author: { type: "string", description: "Filter to a specific handle or author name." },
        news_only: { type: "boolean", description: "Only return news-classified posts." },
        since_hours: { type: "number", description: "Only posts from the last N hours." },
        min_score: { type: "number", description: "Minimum composite relevance score (0-1)." },
        limit: { type: "number", description: "Max results (default 20)." },
      },
    },
  },
  {
    name: "recent_feed",
    description: "Get the most recent feed posts without keyword filtering. Use for 'what's new'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        news_only: { type: "boolean", description: "Only return news-classified posts." },
        limit: { type: "number", description: "Max results (default 20)." },
      },
    },
  },
  {
    name: "search_summaries",
    description: "Get past digest summaries, most recent first, optionally limited to recent ones.",
    inputSchema: {
      type: "object" as const,
      properties: {
        since_hours: { type: "number", description: "Only digests from the last N hours." },
        limit: { type: "number", description: "Max digests (default 5)." },
      },
    },
  },
  {
    name: "get_latest_summary",
    description: "Get the single most recent digest summary.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

function runTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "search_feed": {
      const q: PostSearchQuery = {
        text: typeof args.query === "string" ? args.query : null,
        author: typeof args.author === "string" ? args.author : null,
        news_only: Boolean(args.news_only),
        since: sinceFrom(args.since_hours),
        min_score: Number(args.min_score) || 0,
        limit: clampLimit(args.limit, 20, 20),
        include_expired: false,
      };
      return searchPosts(q).map(projectPost);
    }
    case "recent_feed":
      return searchPosts({
        text: null,
        author: null,
        news_only: Boolean(args.news_only),
        since: null,
        min_score: 0,
        limit: clampLimit(args.limit, 20, 20),
        include_expired: false,
      }).map(projectPost);
    case "search_summaries":
      return searchSummaries({
        since: sinceFrom(args.since_hours),
        limit: clampLimit(args.limit, 5, 20),
      }).map(projectSummary);
    case "get_latest_summary": {
      const latest = getLatestSummary();
      return latest ? projectSummary(latest) : null;
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

const server = new Server(
  { name: "xfeed", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = runTool(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("xfeed MCP server ready\n");
}

main().catch((err) => {
  process.stderr.write(`xfeed MCP fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
