import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ChatEvent, ChatMessage, ChatResponse } from "../shared/chat.ts";
import { validateLayout, type Layout } from "../shared/layout.ts";
import { config } from "./config.ts";

const MAX_HISTORY = 40;
const CLAUDE_TIMEOUT_MS = 165_000;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const mcpPath = join(here, "chatMcp.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

const MCP_CONFIG = JSON.stringify({
  mcpServers: { xfeed: { command: tsxBin, args: [mcpPath] } },
});

const ALLOWED_TOOLS = [
  "mcp__xfeed__search_feed",
  "mcp__xfeed__recent_feed",
  "mcp__xfeed__search_summaries",
  "mcp__xfeed__get_latest_summary",
];

const SYSTEM_PROMPT = `You are xFeed's assistant. You answer the reader's questions about their own
curated feed of social and news posts, and about the periodic digests generated from it.
Reader interests: ${config.interest_topics.join(", ")}.

Use the xfeed tools to search the feed and the digests. Always ground answers in tool
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

interface ClaudeResult {
  result: string;
  isError: boolean;
  numTurns: number;
}

const TOOL_PREFIX = "mcp__xfeed__";

function toolArgSummary(name: string, input: Record<string, unknown>): string {
  const short = name.slice(TOOL_PREFIX.length);
  const parts: string[] = [];
  if (typeof input.query === "string" && input.query) parts.push(`"${input.query}"`);
  if (typeof input.author === "string" && input.author) parts.push(`@${input.author}`);
  if (input.news_only) parts.push("news");
  if (Number(input.since_hours) > 0) parts.push(`${Number(input.since_hours)}h`);
  if (Number(input.min_score) > 0) parts.push(`score≥${Number(input.min_score)}`);
  if (Number(input.limit) > 0) parts.push(`limit ${Number(input.limit)}`);
  return parts.length ? `${short} ${parts.join(", ")}` : short;
}

function resultCount(content: unknown): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((c) => (c && typeof c === "object" ? (c as { text?: string }).text ?? "" : "")).join("");
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return `${parsed.length} result${parsed.length === 1 ? "" : "s"}`;
    if (parsed === null) return "none";
    return "ok";
  } catch {
    return text.startsWith("error:") ? "error" : "ok";
  }
}

function runClaude(
  prompt: string,
  withTools: boolean,
  onEvent?: (ev: ChatEvent) => void,
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
    ];
    if (withTools) {
      args.push("--mcp-config", MCP_CONFIG, "--allowedTools", ...ALLOWED_TOOLS);
      args.push("--append-system-prompt", SYSTEM_PROMPT);
    } else {
      args.push("--mcp-config", '{"mcpServers":{}}');
    }

    const proc = spawn("claude", args, { cwd: repoRoot });
    let buf = "";
    let err = "";
    let final: ClaudeResult | null = null;
    const idToName = new Map<string, string>();

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("claude timed out"));
    }, CLAUDE_TIMEOUT_MS);

    const handle = (m: Record<string, unknown>) => {
      const type = m.type;
      if (type === "assistant") {
        const content = (m.message as { content?: unknown[] })?.content ?? [];
        for (const raw of content) {
          const b = raw as { type?: string; name?: string; id?: string; input?: Record<string, unknown> };
          if (b.type === "tool_use" && typeof b.name === "string" && b.name.startsWith(TOOL_PREFIX)) {
            idToName.set(b.id ?? "", b.name.slice(TOOL_PREFIX.length));
            onEvent?.({ kind: "call", label: toolArgSummary(b.name, b.input ?? {}) });
          }
        }
      } else if (type === "user") {
        const content = (m.message as { content?: unknown[] })?.content ?? [];
        for (const raw of content) {
          const b = raw as { type?: string; tool_use_id?: string; content?: unknown };
          if (b.type === "tool_result") {
            const short = idToName.get(b.tool_use_id ?? "");
            if (short) onEvent?.({ kind: "done", label: `${short} → ${resultCount(b.content)}` });
          }
        }
      } else if (type === "result") {
        final = {
          result: typeof m.result === "string" ? m.result : "",
          isError: Boolean(m.is_error),
          numTurns: Number(m.num_turns) || 1,
        };
      }
    };

    proc.stdout.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* ignore non-JSON lines */
        }
      }
    });
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (final) {
        if (code !== 0) final.isError = true;
        resolve(final);
      } else {
        reject(new Error(`claude exited ${code}: ${err.slice(0, 200) || "no output"}`));
      }
    });
  });
}

function buildPrompt(history: ChatMessage[]): string {
  const turns = history.slice(-MAX_HISTORY);
  const last = turns[turns.length - 1];
  if (turns.length <= 1) return last?.content ?? "";
  const prior = turns
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return `Conversation so far:\n${prior}\n\nNow answer the latest user message:\n${last.content}`;
}

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
  try {
    const res = await runClaude(`${RENDER_PROMPT}\n\nAnswer to convert:\n${reply}`, false);
    const layout = validateLayout(parseLayoutJson(res.result));
    return layout.blocks.length > 0 ? layout : null;
  } catch {
    return null;
  }
}

export async function runChat(
  history: ChatMessage[],
  onEvent?: (ev: ChatEvent) => void,
): Promise<ChatResponse> {
  try {
    const res = await runClaude(buildPrompt(history), true, onEvent);
    const reply = res.result || (res.isError ? "Chat failed: the assistant returned an error." : "");
    const layout = config.chat.render && reply ? await renderLayout(reply) : null;
    return {
      reply,
      layout,
      tool_calls_made: Math.max(0, res.numTurns - 1),
      truncated: false,
    };
  } catch (err) {
    return {
      reply: `Chat failed: ${err instanceof Error ? err.message : "unknown error"}`,
      layout: null,
      tool_calls_made: 0,
      truncated: false,
    };
  }
}
