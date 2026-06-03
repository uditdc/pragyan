import { Box, Text } from "ink";
import type { MonitorState, MonitorStatus, UptimeSnapshot } from "../shared/uptime.ts";
import { P } from "./theme.ts";
import { fmtClock } from "./format.ts";
import { Panel } from "./Panel.tsx";

const STATE_GLYPH: Record<MonitorState, string> = {
  up: "●",
  down: "✕",
  unknown: "◌",
};

const STATE_COLOR: Record<MonitorState, string> = {
  up: P.up,
  down: P.down,
  unknown: P.faint,
};

const HEARTBEAT = 24;

function latency(ms: number | null): string {
  return ms === null ? "—" : `${ms}ms`;
}

function Heartbeat({ history }: { history: boolean[] }) {
  const recent = history.slice(-HEARTBEAT);
  if (recent.length === 0) return <Text color={P.faint}>no checks yet</Text>;
  return (
    <Text>
      {recent.map((ok, i) => (
        <Text key={i} color={ok ? P.up : P.down}>
          {ok ? "▀" : "▄"}
        </Text>
      ))}
    </Text>
  );
}

function MonitorRow({ m, inner }: { m: MonitorStatus; inner: number }) {
  const note =
    m.state === "down" && m.last_error
      ? `${m.last_error}${m.consecutive_failures > 1 ? ` ×${m.consecutive_failures}` : ""}`
      : "";
  return (
    <Box width={inner}>
      <Box width={2}>
        <Text color={STATE_COLOR[m.state]}>{STATE_GLYPH[m.state]}</Text>
      </Box>
      <Box width={14}>
        <Text color={P.fg} wrap="truncate">
          {m.name}
        </Text>
      </Box>
      <Box width={8} justifyContent="flex-end">
        <Text color={P.dim}>{latency(m.latency_ms)}</Text>
      </Box>
      <Box width={9} justifyContent="flex-end">
        <Text color={m.uptime_pct >= 99 ? P.up : m.uptime_pct >= 90 ? P.news : P.down}>
          {m.uptime_pct.toFixed(1)}%
        </Text>
      </Box>
      <Box width={HEARTBEAT + 2} paddingX={1}>
        <Heartbeat history={m.history} />
      </Box>
      <Box flexGrow={1}>
        <Text color={P.down} wrap="truncate">
          {note}
        </Text>
      </Box>
    </Box>
  );
}

export function UptimeView({
  snapshot,
  width,
  height,
  now,
}: {
  snapshot: UptimeSnapshot | null;
  width: number;
  height: number;
  now: number;
}) {
  const inner = Math.max(10, width - 6);
  const down = snapshot ? snapshot.monitors.filter((m) => m.state === "down").length : 0;

  const meta = snapshot ? (
    <Text color={P.faint}>
      {snapshot.monitors.length} monitors
      {down > 0 ? <Text color={P.down}> · {down} down</Text> : " · all up"} · updated{" "}
      {fmtClock(Date.parse(snapshot.fetched_at) || now)}
    </Text>
  ) : undefined;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel
        icon="◴"
        iconColor={P.accent}
        title="UPTIME — service monitors"
        meta={meta}
        width={width - 2}
        flexGrow={1}
      >
        {!snapshot ? (
          <Text color={P.faint}>loading monitors …</Text>
        ) : snapshot.monitors.length === 0 ? (
          <Text color={P.faint}>no monitors configured — add services to config.json</Text>
        ) : (
          snapshot.monitors.map((m) => <MonitorRow key={m.name} m={m} inner={inner} />)
        )}
      </Panel>
    </Box>
  );
}
