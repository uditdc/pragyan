export type CitationSource = "feed" | "summary" | "market" | "model";

export interface Citation {
  source: CitationSource;
  label: string;
  url?: string;
}

export interface HeadingBlock {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  kicker?: string;
}

export interface TextBlock {
  type: "text";
  text: string;
  tone: "default" | "muted";
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  items: string[];
}

export interface KvBlock {
  type: "kv";
  pairs: { key: string; value: string }[];
}

export interface TableBlock {
  type: "table";
  columns: string[];
  rows: string[][];
  align: ("left" | "right")[];
}

export interface CalloutBlock {
  type: "callout";
  variant: "info" | "warn" | "success" | "danger";
  title?: string;
  text: string;
}

export interface BarsBlock {
  type: "bars";
  items: { label: string; value: number; note?: string }[];
  max?: number;
}

export interface ColumnsBlock {
  type: "columns";
  columns: { weight: number; blocks: Block[] }[];
}

export interface DividerBlock {
  type: "divider";
  label?: string;
}

export interface CitationsBlock {
  type: "citations";
  items: Citation[];
}

export type Block =
  | HeadingBlock
  | TextBlock
  | ListBlock
  | KvBlock
  | TableBlock
  | CalloutBlock
  | BarsBlock
  | ColumnsBlock
  | DividerBlock
  | CitationsBlock;

export interface Layout {
  title: string;
  blocks: Block[];
}

const MAX_COLUMN_DEPTH = 2;

function str(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((s) => str(s, maxLen));
}

function coerceCitation(raw: unknown): Citation | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const label = str(o.label, 40);
  if (!label) return null;
  const source: CitationSource =
    o.source === "summary" || o.source === "market" || o.source === "model"
      ? o.source
      : "feed";
  const url = typeof o.url === "string" && o.url.startsWith("http") ? o.url : undefined;
  return { source, label, ...(url ? { url } : {}) };
}

function coerceBlock(raw: unknown, depth: number): Block | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  switch (o.type) {
    case "heading": {
      const text = str(o.text, 120);
      if (!text) return null;
      const level = o.level === 2 ? 2 : o.level === 3 ? 3 : 1;
      const kicker = str(o.kicker, 16).toUpperCase();
      return { type: "heading", level, text, ...(kicker ? { kicker } : {}) };
    }
    case "text": {
      const text = str(o.text, 4000);
      if (!text) return null;
      return { type: "text", text, tone: o.tone === "muted" ? "muted" : "default" };
    }
    case "list": {
      const items = strArray(o.items, 40, 300).filter(Boolean);
      if (items.length === 0) return null;
      return { type: "list", ordered: o.ordered === true, items };
    }
    case "kv": {
      const pairs = Array.isArray(o.pairs)
        ? (o.pairs as unknown[])
            .slice(0, 24)
            .map((p) => {
              const po = (p ?? {}) as Record<string, unknown>;
              return { key: str(po.key, 32), value: str(po.value, 200) };
            })
            .filter((p) => p.key)
        : [];
      if (pairs.length === 0) return null;
      return { type: "kv", pairs };
    }
    case "table": {
      const columns = strArray(o.columns, 6, 32).filter(Boolean);
      if (columns.length === 0) return null;
      const rows = Array.isArray(o.rows)
        ? (o.rows as unknown[])
            .slice(0, 50)
            .map((r) => {
              const cells = strArray(r, columns.length, 120);
              while (cells.length < columns.length) cells.push("");
              return cells;
            })
        : [];
      const align = columns.map((_, i) => {
        const a = Array.isArray(o.align) ? (o.align as unknown[])[i] : undefined;
        return a === "right" ? ("right" as const) : ("left" as const);
      });
      return { type: "table", columns, rows, align };
    }
    case "callout": {
      const text = str(o.text, 1000);
      if (!text) return null;
      const variant =
        o.variant === "warn" || o.variant === "success" || o.variant === "danger"
          ? o.variant
          : "info";
      const title = str(o.title, 60);
      return { type: "callout", variant, text, ...(title ? { title } : {}) };
    }
    case "bars": {
      const items = Array.isArray(o.items)
        ? (o.items as unknown[])
            .slice(0, 16)
            .map((b) => {
              const bo = (b ?? {}) as Record<string, unknown>;
              const note = str(bo.note, 40);
              return {
                label: str(bo.label, 24),
                value: Math.max(0, Number(bo.value) || 0),
                ...(note ? { note } : {}),
              };
            })
            .filter((b) => b.label)
        : [];
      if (items.length === 0) return null;
      const max = Number(o.max);
      return { type: "bars", items, ...(Number.isFinite(max) && max > 0 ? { max } : {}) };
    }
    case "columns": {
      if (depth >= MAX_COLUMN_DEPTH || !Array.isArray(o.columns)) return null;
      const columns = (o.columns as unknown[])
        .slice(0, 4)
        .map((c) => {
          const co = (c ?? {}) as Record<string, unknown>;
          const weight = Number(co.weight);
          return {
            weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
            blocks: coerceBlocks(co.blocks, depth + 1),
          };
        })
        .filter((c) => c.blocks.length > 0);
      if (columns.length < 2) return null;
      return { type: "columns", columns };
    }
    case "divider": {
      const label = str(o.label, 40);
      return { type: "divider", ...(label ? { label } : {}) };
    }
    case "citations": {
      const items = Array.isArray(o.items)
        ? (o.items as unknown[]).slice(0, 12).map(coerceCitation).filter((c): c is Citation => c !== null)
        : [];
      if (items.length === 0) return null;
      return { type: "citations", items };
    }
    default:
      return null;
  }
}

function coerceBlocks(raw: unknown, depth: number): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((b) => coerceBlock(b, depth))
    .filter((b): b is Block => b !== null);
}

export function validateLayout(raw: unknown): Layout {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    title: str(o.title, 80) || "Answer",
    blocks: coerceBlocks(o.blocks, 0),
  };
}
