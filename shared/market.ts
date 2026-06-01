export interface Ticker {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  change_abs: number;
  change_pct: number;
  updated_at: string;
}

export interface PredictionMarket {
  id: string;
  question: string;
  outcome: string;
  probability: number;
  volume24h: number;
  url: string;
  updated_at: string;
}

export interface MarketsSnapshot {
  crypto: Ticker[];
  indices: Ticker[];
  polymarkets: PredictionMarket[];
  fetched_at: string;
  stale: boolean;
}
