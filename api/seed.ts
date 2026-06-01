import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { HarvestedPost } from "../shared/post.ts";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl =
  process.env.XFEED_API ?? `http://${config.server.host}:${config.server.port}`;

const posts = JSON.parse(
  readFileSync(join(here, "seed.json"), "utf8"),
) as HarvestedPost[];

const now = new Date().toISOString();
const stamped = posts.map((p) => ({ ...p, harvested_at: now }));

try {
  const res = await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posts: stamped }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const result = await res.json();
  console.log(`seeded ${baseUrl} →`, result);
} catch (err) {
  console.error(
    `failed to seed ${baseUrl}: ${(err as Error).message}\n` +
      `is the API running?  start it with:  npm start`,
  );
  process.exit(1);
}
