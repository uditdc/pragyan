import type { MonitorState, MonitorStatus, UptimeSnapshot } from "../shared/uptime.ts";
import { config } from "./config.ts";

interface Sample {
  ok: boolean;
  latency_ms: number;
}

interface MonitorRuntime {
  name: string;
  url: string;
  samples: Sample[];
  state: MonitorState;
  consecutive_failures: number;
  last_error: string | null;
  last_checked: string | null;
  last_latency_ms: number | null;
}

const UA = "xfeed-uptime/0.1 (personal use)";

const monitors: MonitorRuntime[] = config.monitors.services.map((s) => ({
  name: s.name,
  url: s.url,
  samples: [],
  state: "unknown",
  consecutive_failures: 0,
  last_error: null,
  last_checked: null,
  last_latency_ms: null,
}));

function toStatus(m: MonitorRuntime): MonitorStatus {
  const up = m.samples.filter((s) => s.ok);
  const avg = up.length
    ? Math.round(up.reduce((sum, s) => sum + s.latency_ms, 0) / up.length)
    : null;
  return {
    name: m.name,
    url: m.url,
    state: m.state,
    latency_ms: m.last_latency_ms,
    avg_latency_ms: avg,
    uptime_pct: m.samples.length
      ? Math.round((up.length / m.samples.length) * 1000) / 10
      : 0,
    checks: m.samples.length,
    consecutive_failures: m.consecutive_failures,
    last_error: m.last_error,
    last_checked: m.last_checked,
    history: m.samples.map((s) => s.ok),
  };
}

export function getUptimeSnapshot(): UptimeSnapshot {
  return {
    monitors: monitors.map(toStatus),
    fetched_at: new Date().toISOString(),
  };
}

async function check(m: MonitorRuntime): Promise<void> {
  const start = Date.now();
  let ok = false;
  let error: string | null = null;
  try {
    const res = await fetch(m.url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(config.monitors.timeout_ms),
    });
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error && e.name === "TimeoutError" ? "timeout" : describe(e);
  }
  const latency = Date.now() - start;

  m.samples.push({ ok, latency_ms: latency });
  if (m.samples.length > config.monitors.history) m.samples.shift();
  m.state = ok ? "up" : "down";
  m.consecutive_failures = ok ? 0 : m.consecutive_failures + 1;
  m.last_error = ok ? null : error;
  m.last_checked = new Date().toISOString();
  m.last_latency_ms = latency;
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "unreachable";
}

async function refresh(): Promise<void> {
  await Promise.all(monitors.map(check));
}

export function startUptime(): void {
  void refresh();
  setInterval(() => void refresh(), config.monitors.interval_ms);
}

export async function checkNow(): Promise<UptimeSnapshot> {
  await refresh();
  return getUptimeSnapshot();
}
