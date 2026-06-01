import type { MarketsSnapshot } from "../shared/market.ts";

export async function fetchMarkets(baseUrl: string): Promise<MarketsSnapshot> {
  const res = await fetch(`${baseUrl}/markets`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`markets ${res.status}`);
  return (await res.json()) as MarketsSnapshot;
}
