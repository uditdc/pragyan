import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CAPABILITIES } from "./capabilitySchema.ts";

// Thin stdio MCP server spawned by Claude Code. It holds NO database handle — it
// proxies every tool call to pragyan's REST API on localhost, so the API process
// stays the single SQLite writer (see docs/plans/phase6.md Step 4).

const BASE = process.env.XFEED_API_BASE ?? "http://127.0.0.1:8787";

const server = new Server(
  { name: "pragyan", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: CAPABILITIES.map((c) => ({
    name: c.name,
    description: c.description,
    inputSchema: c.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const res = await fetch(`${BASE}/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json()) as { result?: unknown; error?: string };
    const payload = data.error ? { error: data.error } : (data.result ?? null);
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: Boolean(data.error),
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `pragyan API unreachable at ${BASE}: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("pragyan MCP server connected (stdio) ->", BASE);
