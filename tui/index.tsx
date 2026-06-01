import { render } from "ink";
import { App } from "./App.tsx";
import { fetchHealth } from "./api.ts";

interface Args {
  baseUrl: string;
  pollMs: number;
  limit: number;
  minScore: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: process.env.XFEED_API ?? "http://127.0.0.1:8787",
    pollMs: 15_000,
    limit: 100,
    minScore: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    if (flag === "--api") args.baseUrl = value;
    else if (flag === "--poll") args.pollMs = Number(value) * 1000;
    else if (flag === "--limit") args.limit = Number(value);
    else if (flag === "--min-score") args.minScore = Number(value);
  }
  return args;
}

const THRESHOLDS = [0, 0.2, 0.4, 0.6];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const healthy = await fetchHealth(args.baseUrl);
  if (!healthy) {
    process.stderr.write(
      `warning: API at ${args.baseUrl} not reachable yet — starting anyway.\n`,
    );
  }

  const initialThresholdIdx = Math.max(
    0,
    THRESHOLDS.findIndex((t) => t >= args.minScore),
  );

  const fullscreen = process.stdout.isTTY === true;
  const leaveAltScreen = () => process.stdout.write("\x1b[?1049l\x1b[?25h");
  if (fullscreen) {
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
    process.on("exit", leaveAltScreen);
  }

  const { waitUntilExit } = render(
    <App
      baseUrl={args.baseUrl}
      pollMs={args.pollMs}
      limit={args.limit}
      initialThresholdIdx={initialThresholdIdx}
    />,
  );

  await waitUntilExit();
  if (fullscreen) leaveAltScreen();
}

void main();
