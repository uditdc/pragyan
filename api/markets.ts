import type {
  MarketsSnapshot,
  PredictionMarket,
  Ticker,
} from "../shared/market.ts";
import { config } from "./config.ts";

let snapshot: MarketsSnapshot = {
  crypto: [],
  indices: [],
  polymarkets: [],
  fetched_at: new Date(0).toISOString(),
  stale: true,
};

export function getSnapshot(): MarketsSnapshot {
  return snapshot;
}

// ── mock provider — random-walks around an open so the feed feels live ──────
const open = { btc: 71800, nifty: 23520 };
const walk = { btc: 71800, nifty: 23520 };

const MOCK_MARKETS = [
  { id: "pm-elec", question: "Will the incumbent win the 2028 election?", outcome: "Yes", base: 0.62, vol: 8_400_000 },
  { id: "pm-rate", question: "Fed cut rates at the next meeting?", outcome: "No", base: 0.71, vol: 5_100_000 },
  { id: "pm-btc", question: "BTC above $100k by year end?", outcome: "Yes", base: 0.38, vol: 12_900_000 },
  { id: "pm-ai", question: "A frontier model passes the bar exam at 95%+?", outcome: "Yes", base: 0.54, vol: 3_300_000 },
  { id: "pm-sport", question: "Will the favorite win the championship?", outcome: "Yes", base: 0.47, vol: 6_700_000 },
];

function jitter(value: number, pct: number): number {
  return value * (1 + (Math.random() - 0.5) * pct);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function ticker(symbol: string, name: string, price: number, openPrice: number, currency: string, now: string): Ticker {
  const change_abs = price - openPrice;
  return {
    symbol,
    name,
    price: Math.round(price * 100) / 100,
    currency,
    change_abs: Math.round(change_abs * 100) / 100,
    change_pct: Math.round((change_abs / openPrice) * 10000) / 100,
    updated_at: now,
  };
}

function mockProvider(): MarketsSnapshot {
  const now = new Date().toISOString();
  walk.btc = clamp(jitter(walk.btc, 0.012), 55_000, 90_000);
  walk.nifty = clamp(jitter(walk.nifty, 0.006), 21_000, 26_000);

  const polymarkets: PredictionMarket[] = MOCK_MARKETS.map((m) => {
    const probability = clamp(jitter(m.base, 0.06), 0.02, 0.98);
    return {
      id: m.id,
      question: m.question,
      outcome: m.outcome,
      probability: Math.round(probability * 1000) / 1000,
      volume24h: Math.round(jitter(m.vol, 0.1)),
      url: `https://polymarket.com/event/${m.id}`,
      updated_at: now,
    };
  }).sort((a, b) => b.volume24h - a.volume24h);

  return {
    crypto: [ticker("BTC", "Bitcoin", walk.btc, open.btc, "USD", now)],
    indices: [ticker("NIFTY 50", "Nifty 50", walk.nifty, open.nifty, "INR", now)],
    polymarkets: polymarkets.slice(0, config.sources.polymarket_count),
    fetched_at: now,
    stale: false,
  };
}

// ── real providers (keyless; selected via config.sources.provider="real") ───
const UA = "xfeed/0.1 (personal use)";

interface CoinMarket {
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number | null;
}

async function fetchCrypto(now: string): Promise<Ticker[]> {
  const n = config.sources.crypto_count;
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${n}&page=1&price_change_percentage=24h`,
    { signal: AbortSignal.timeout(6000) },
  );
  const data = (await res.json()) as CoinMarket[];
  return data.map((c) => {
    const pct = c.price_change_percentage_24h ?? 0;
    const prev = c.current_price / (1 + pct / 100);
    return ticker(c.symbol.toUpperCase(), c.name, c.current_price, prev, "USD", now);
  });
}

// Global indices and commodities with public, keyless Yahoo Finance chart data.
// NIFTY stays first so the always-on MarketStrip keeps showing it.
const INDEX_SYMBOLS = [
  { label: "NIFTY 50", yahoo: "%5ENSEI" },
  { label: "SENSEX", yahoo: "%5EBSESN" },
  { label: "S&P 500", yahoo: "%5EGSPC" },
  { label: "NASDAQ", yahoo: "%5EIXIC" },
  { label: "DOW", yahoo: "%5EDJI" },
  { label: "FTSE 100", yahoo: "%5EFTSE" },
  { label: "NIKKEI", yahoo: "%5EN225" },
  { label: "DAX", yahoo: "%5EGDAXI" },
  { label: "GOLD", yahoo: "GC%3DF" },
  { label: "CRUDE", yahoo: "CL%3DF" },
] as const;

async function fetchIndex(sym: (typeof INDEX_SYMBOLS)[number], now: string): Promise<Ticker> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym.yahoo}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6000),
  });
  const data = (await res.json()) as {
    chart: { result?: { meta: { regularMarketPrice: number; previousClose: number; currency: string } }[] };
  };
  const meta = data.chart.result?.[0]?.meta;
  if (!meta) throw new Error(`no data for ${sym.label}`);
  return ticker(sym.label, sym.label, meta.regularMarketPrice, meta.previousClose, meta.currency, now);
}

async function fetchIndices(now: string): Promise<Ticker[]> {
  const settled = await Promise.allSettled(INDEX_SYMBOLS.map((s) => fetchIndex(s, now)));
  const tickers = settled
    .filter((r): r is PromiseFulfilledResult<Ticker> => r.status === "fulfilled")
    .map((r) => r.value);
  if (tickers.length === 0) throw new Error("indices unavailable");
  return tickers;
}

interface GammaMarket {
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
}
interface GammaEvent {
  slug?: string;
  id?: string | number;
  title?: string;
  volume24hr?: number;
  markets?: GammaMarket[];
}

// The leading outcome across an event's markets: for a grouped multi-outcome event
// (e.g. World Cup winner) it's the favorite candidate's Yes price; for a binary market
// it's whichever of Yes/No is more likely.
function leadingOutcome(markets: GammaMarket[]): { label: string; prob: number } | null {
  let best: { label: string; prob: number } | null = null;
  const consider = (label: string, prob: number) => {
    if (Number.isFinite(prob) && (!best || prob > best.prob)) best = { label, prob };
  };
  for (const m of markets) {
    let outcomes: string[];
    let prices: number[];
    try {
      outcomes = JSON.parse(m.outcomes ?? "[]") as string[];
      prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
    } catch {
      continue;
    }
    if (outcomes.length === 0 || outcomes.length !== prices.length) continue;
    const binaryYesNo = outcomes.length === 2 && outcomes.includes("Yes") && outcomes.includes("No");
    if (m.groupItemTitle && binaryYesNo) {
      consider(m.groupItemTitle, prices[outcomes.indexOf("Yes")]);
    } else {
      outcomes.forEach((o, i) => consider(o, prices[i]));
    }
  }
  return best;
}

async function fetchPolymarkets(now: string): Promise<PredictionMarket[]> {
  const n = config.sources.polymarket_count;
  const res = await fetch(
    "https://gamma-api.polymarket.com/events?closed=false&active=true&order=volume24hr&ascending=false&limit=20",
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) },
  );
  const events = (await res.json()) as GammaEvent[];
  return events
    .map((ev): PredictionMarket | null => {
      const lead = leadingOutcome(ev.markets ?? []);
      if (!lead) return null;
      const slug = ev.slug ?? String(ev.id ?? "");
      return {
        id: slug,
        question: ev.title ?? lead.label,
        outcome: lead.label,
        probability: lead.prob,
        volume24h: Math.round(ev.volume24hr ?? 0),
        url: `https://polymarket.com/event/${slug}`,
        updated_at: now,
      };
    })
    .filter((m): m is PredictionMarket => m !== null)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, n);
}

async function realProvider(prev: MarketsSnapshot): Promise<MarketsSnapshot> {
  const now = new Date().toISOString();
  let stale = false;
  const settle = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      stale = true;
      return fallback;
    }
  };
  const [crypto, indices, polymarkets] = await Promise.all([
    settle(fetchCrypto(now), prev.crypto),
    settle(fetchIndices(now), prev.indices),
    settle(fetchPolymarkets(now), prev.polymarkets),
  ]);
  return { crypto, indices, polymarkets, fetched_at: now, stale };
}

async function refresh(): Promise<void> {
  snapshot =
    config.sources.provider === "real" ? await realProvider(snapshot) : mockProvider();
}

export function startMarkets(): void {
  void refresh();
  setInterval(() => void refresh(), config.sources.poll_interval_ms);
}
