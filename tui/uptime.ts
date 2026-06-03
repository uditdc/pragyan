import type { UptimeSnapshot } from "../shared/uptime.ts";

export async function fetchUptime(baseUrl: string): Promise<UptimeSnapshot> {
  const res = await fetch(`${baseUrl}/uptime`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`uptime ${res.status}`);
  return (await res.json()) as UptimeSnapshot;
}

export async function recheckUptime(baseUrl: string): Promise<UptimeSnapshot> {
  const res = await fetch(`${baseUrl}/uptime/check`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`uptime check ${res.status}`);
  return (await res.json()) as UptimeSnapshot;
}
