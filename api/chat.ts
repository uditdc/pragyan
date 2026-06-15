import type OpenAI from "openai";
import type { ChatEvent, ChatMessage, ChatResponse } from "../shared/chat.ts";
import { validateLayout, type Layout } from "../shared/layout.ts";
import type { Post } from "../shared/post.ts";
import type { SummaryRecord } from "../shared/summary.ts";
import {
  searchPosts,
  searchSummaries,
  getLatestSummary,
  type PostSearchQuery,
} from "./db.ts";
import { config } from "./config.ts";
import { chatClient, chatEnabled, chatModel } from "./llm.ts";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const MAX_HISTORY = 40;
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `You are xFeed's assistant. You answer the reader's questions about their own
curated feed of social and news posts, and about the periodic digests generated from it.
Reader interests: ${config.interest_topics.join(", ")}.

Use the provided tools to search the feed and the digests. Always ground answers in tool
results — call a tool before claiming what is or isn't in the feed. Cite the handles or
outlets that appear in the results. Be terse and concrete; if a search returns nothing,
say so plainly instead of guessing. Questions are about recent activity unless stated otherwise.`;

const RENDER_PROMPT = `Convert the answer below into a terminal display layout.
Output JSON only, matching exactly this shape:

{
  "title": "short pane title",
  "blocks": [ <block>, ... ]
}

Each <block> is one of:
{ "type": "heading", "level": 1|2|3, "text": "...", "kicker": "ONE-WORD UPPERCASE LABEL (optional)" }
{ "type": "text", "text": "paragraphs separated by \\n", "tone": "default"|"muted" }
{ "type": "list", "ordered": true|false, "items": ["...", ...] }
{ "type": "kv", "pairs": [{ "key": "...", "value": "..." }, ...] }
{ "type": "table", "columns": ["...", ...], "rows": [["...", ...], ...], "align": ["left"|"right", ...] }
{ "type": "callout", "variant": "info"|"warn"|"success"|"danger", "title": "...", "text": "..." }
{ "type": "bars", "items": [{ "label": "...", "value": <number>, "note": "..." }, ...], "max": <number, optional> }
{ "type": "columns", "columns": [{ "weight": <number>, "blocks": [<block>, ...] }, ...] }
{ "type": "divider", "label": "... (optional)" }
{ "type": "citations", "items": [{ "source": "feed"|"summary"|"market"|"model", "label": "@handle or outlet", "url": "... (optional)" }] }

Hard rules:
- JSON only. No markdown, no prose, no text outside the JSON object.
- 2-10 top-level blocks. Lead with a heading or one-line text answer, then supporting detail.
- Use "table" for post lists and "bars" for comparing counts; "columns" (2-3) only when content splits side-by-side; never nest columns.
- Keep table cells and kv values short; terminals truncate, they do not scroll sideways.`;

// ── tools — feed/digest search, backed directly by the SQLite store ──────────
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

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_feed",
      description:
        "Search the reader's feed posts by keyword and/or author. Returns matching posts, most recent first.",
      parameters: {
        type: "object",
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
  },
  {
    type: "function",
    function: {
      name: "recent_feed",
      description: "Get the most recent feed posts without keyword filtering. Use for 'what's new'.",
      parameters: {
        type: "object",
        properties: {
          news_only: { type: "boolean", description: "Only return news-classified posts." },
          limit: { type: "number", description: "Max results (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_summaries",
      description: "Get past digest summaries, most recent first, optionally limited to recent ones.",
      parameters: {
        type: "object",
        properties: {
          since_hours: { type: "number", description: "Only digests from the last N hours." },
          limit: { type: "number", description: "Max digests (default 5)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_summary",
      description: "Get the single most recent digest summary.",
      parameters: { type: "object", properties: {} },
    },
  },
];

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

function toolArgSummary(name: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.query === "string" && input.query) parts.push(`"${input.query}"`);
  if (typeof input.author === "string" && input.author) parts.push(`@${input.author}`);
  if (input.news_only) parts.push("news");
  if (Number(input.since_hours) > 0) parts.push(`${Number(input.since_hours)}h`);
  if (Number(input.min_score) > 0) parts.push(`score≥${Number(input.min_score)}`);
  if (Number(input.limit) > 0) parts.push(`limit ${Number(input.limit)}`);
  return parts.length ? `${name} ${parts.join(", ")}` : name;
}

function resultCount(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} result${result.length === 1 ? "" : "s"}`;
  if (result === null) return "none";
  if (result && typeof result === "object" && "error" in result) return "error";
  return "ok";
}

// ── layout rendering — a second pass that lays the answer out for the TUI ────
function closersFor(prefix: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of prefix) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  return stack.reverse().join("");
}

function parseLayoutJson(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const body = start >= 0 ? stripped.slice(start) : stripped;

  const candidates = [body, body.replace(/,\s*([\]}])/g, "$1")];
  for (let cut = body.length, i = 0; i < 8; i++) {
    const idx = body.lastIndexOf("}", cut - 1);
    if (idx < 0) break;
    const prefix = body.slice(0, idx + 1);
    candidates.push(prefix + closersFor(prefix));
    cut = idx;
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next repair */
    }
  }
  return {};
}

async function renderLayout(reply: string): Promise<Layout | null> {
  if (!chatClient) return null;
  try {
    const res = await chatClient.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RENDER_PROMPT },
        { role: "user", content: `Answer to convert:\n${reply}` },
      ],
    });
    const layout = validateLayout(parseLayoutJson(res.choices[0]?.message?.content ?? "{}"));
    return layout.blocks.length > 0 ? layout : null;
  } catch {
    return null;
  }
}

function buildHistory(history: ChatMessage[]): MessageParam[] {
  return history
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function converse(
  history: ChatMessage[],
  onEvent?: (ev: ChatEvent) => void,
): Promise<ChatResponse> {
  const messages: MessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...buildHistory(history),
  ];

  let toolCallsMade = 0;
  for (let round = 0; ; round++) {
    // Force a tool call on the first round so the answer is grounded in the feed —
    // left to "auto", some models confabulate instead of searching. After results
    // are in hand, "auto" lets the model search more or answer; the last round
    // disallows tools so it must produce a final reply.
    const tool_choice =
      round >= MAX_TOOL_ROUNDS ? "none" : round === 0 ? "required" : "auto";
    const res = await chatClient!.chat.completions.create({
      model: chatModel,
      temperature: 0.3,
      messages,
      tools: TOOLS,
      tool_choice,
    });
    const msg = res.choices[0]?.message;
    const toolCalls = msg?.tool_calls ?? [];

    if (!msg || toolCalls.length === 0) {
      const reply = msg?.content ?? "";
      const layout = config.chat.render && reply ? await renderLayout(reply) : null;
      return { reply, layout, tool_calls_made: toolCallsMade, truncated: false };
    }

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* malformed arguments — run with empty args */
      }
      onEvent?.({ kind: "call", label: toolArgSummary(name, args) });
      const result = runTool(name, args);
      toolCallsMade++;
      onEvent?.({ kind: "done", label: `${name} → ${resultCount(result)}` });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
}

export async function runChat(
  history: ChatMessage[],
  onEvent?: (ev: ChatEvent) => void,
): Promise<ChatResponse> {
  if (!chatClient || !chatEnabled) {
    return {
      reply:
        "Chat is unavailable: no LLM endpoint configured. Set XFEED_CHAT_BASE_URL and XFEED_CHAT_API_KEY (or the shared XFEED_LLM_* vars).",
      layout: null,
      tool_calls_made: 0,
      truncated: false,
    };
  }
  try {
    return await converse(history, onEvent);
  } catch (err) {
    return {
      reply: `Chat failed: ${err instanceof Error ? err.message : "unknown error"}`,
      layout: null,
      tool_calls_made: 0,
      truncated: false,
    };
  }
}
