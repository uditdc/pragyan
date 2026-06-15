import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./api/config.ts";
import { fetchHealth } from "./tui/api.ts";
import { runTui } from "./tui/index.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl =
  process.env.XFEED_API ?? `http://${config.server.host}:${config.server.port}`;

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchHealth(baseUrl)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (await fetchHealth(baseUrl)) {
    await runTui();
    return;
  }

  const tsx = join(here, "node_modules", ".bin", "tsx");
  const errlog: Buffer[] = [];
  const server = spawn(
    tsx,
    ["--env-file-if-exists=.env", join(here, "api", "server.ts")],
    { cwd: here, stdio: ["ignore", "ignore", "pipe"] },
  );
  server.stderr.on("data", (chunk: Buffer) => errlog.push(chunk));

  let serverExited = false;
  server.on("exit", (code) => {
    serverExited = true;
    if (code && code !== 0) {
      process.stderr.write(Buffer.concat(errlog).toString());
      process.stderr.write(`server exited with code ${code}\n`);
    }
  });

  const stopServer = () => {
    if (!serverExited) server.kill("SIGTERM");
  };
  process.once("exit", stopServer);
  process.once("SIGINT", stopServer);
  process.once("SIGTERM", stopServer);

  if (!(await waitForHealth(15_000))) {
    stopServer();
    process.stderr.write(Buffer.concat(errlog).toString());
    process.stderr.write(`error: server at ${baseUrl} did not become ready.\n`);
    process.exit(1);
  }

  await runTui();
  stopServer();
}

void main();
