// The living day report: one Markdown file per local day under .kb/daily/,
// rewritten by each /pragyan-tick pass and left standing as the durable daily
// record once the day ends.
export interface ReportRecord {
  day: string;
  updated_at: string;
  revision: number;
  window_end: string;
  item_count: number;
  tldr: string;
  markdown: string;
  source_refs: string[];
}

export interface ReportsResponse {
  reports: ReportRecord[];
  new_since: number;
}
