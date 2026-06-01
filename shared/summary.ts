export type DigestSource = "x" | "news";

export interface Citation {
  source: DigestSource;
  label: string;
}

export interface Theme {
  kicker: string;
  title: string;
  body: string;
  citations: Citation[];
}

export interface Mover {
  symbol: string;
  price: number;
  change_pct: number;
}

export interface Sentiment {
  pos: number;
  neu: number;
  neg: number;
}

export interface TopVoice {
  source: DigestSource;
  handle: string;
  note: string;
}

export interface Digest {
  tldr: string;
  themes: Theme[];
  movers: Mover[];
  sentiment: Sentiment;
  top_voices: TopVoice[];
}

export type SummaryStatus = "ok" | "empty" | "error";

export interface SummaryRecord {
  id: number;
  generated_at: string;
  window_start: string;
  window_end: string;
  item_count: number;
  source_counts: { x: number; news: number };
  gen_ms: number | null;
  model: string | null;
  status: SummaryStatus;
  digest: Digest;
}

export interface SummaryResponse {
  summary: SummaryRecord | null;
  new_since: number;
}

export interface SummariesResponse {
  summaries: SummaryRecord[];
  new_since: number;
}

export const EMPTY_DIGEST: Digest = {
  tldr: "",
  themes: [],
  movers: [],
  sentiment: { pos: 0, neu: 0, neg: 0 },
  top_voices: [],
};
