export type MonitorState = "up" | "down" | "unknown";

export interface MonitorStatus {
  name: string;
  url: string;
  state: MonitorState;
  latency_ms: number | null;
  avg_latency_ms: number | null;
  uptime_pct: number;
  checks: number;
  consecutive_failures: number;
  last_error: string | null;
  last_checked: string | null;
  history: boolean[];
}

export interface UptimeSnapshot {
  monitors: MonitorStatus[];
  fetched_at: string;
}
