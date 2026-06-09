import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type {
  BarsBlock,
  Block,
  CalloutBlock,
  CitationSource,
  CitationsBlock,
  ColumnsBlock,
  HeadingBlock,
  KvBlock,
  ListBlock,
  TableBlock,
  TextBlock,
} from "../shared/layout.ts";
import { wrapText } from "./format.ts";
import { P } from "./theme.ts";

interface Rendered {
  node: ReactNode;
  lines: number;
}

const VARIANT_COLOR = {
  info: P.x,
  warn: P.news,
  success: P.up,
  danger: P.down,
} as const;

const SOURCE_COLOR: Record<CitationSource, string> = {
  feed: P.accent,
  summary: P.news,
  market: P.up,
  model: P.log,
};

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, Math.max(0, width - 1)).trimEnd() + "…";
}

function pad(s: string, width: number, right: boolean): string {
  const t = truncate(s, width);
  return right ? t.padStart(width) : t.padEnd(width);
}

function buildHeading(b: HeadingBlock, width: number): Rendered {
  const color = b.level === 3 ? P.dim : P.white;
  const lines = wrapText(b.text, Math.max(4, width - (b.kicker ? b.kicker.length + 1 : 0)));
  return {
    node: (
      <Box flexDirection="column">
        <Text>
          {b.kicker ? <Text color={P.accent} bold>{b.kicker} </Text> : null}
          <Text color={color} bold>{lines[0]}</Text>
        </Text>
        {lines.slice(1).map((l, i) => (
          <Text key={i} color={color} bold>{l}</Text>
        ))}
        {b.level === 1 ? <Text color={P.rule}>{"─".repeat(Math.max(1, width))}</Text> : null}
      </Box>
    ),
    lines: lines.length + (b.level === 1 ? 1 : 0),
  };
}

function buildText(b: TextBlock, width: number): Rendered {
  const lines = wrapText(b.text, width);
  const color = b.tone === "muted" ? P.dim : P.fg;
  return {
    node: (
      <Box flexDirection="column">
        {lines.map((l, i) => (
          <Text key={i} color={color}>{l || " "}</Text>
        ))}
      </Box>
    ),
    lines: lines.length,
  };
}

function buildList(b: ListBlock, width: number): Rendered {
  let total = 0;
  const items = b.items.map((item, i) => {
    const prefix = b.ordered ? `${i + 1}. ` : "• ";
    const lines = wrapText(item, Math.max(4, width - prefix.length));
    total += lines.length;
    return (
      <Box key={i} flexDirection="column">
        <Text>
          <Text color={P.accent}>{prefix}</Text>
          <Text color={P.fg}>{lines[0]}</Text>
        </Text>
        {lines.slice(1).map((l, j) => (
          <Text key={j} color={P.fg}>{" ".repeat(prefix.length)}{l}</Text>
        ))}
      </Box>
    );
  });
  return { node: <Box flexDirection="column">{items}</Box>, lines: total };
}

function buildKv(b: KvBlock, width: number): Rendered {
  const keyW = Math.min(24, Math.max(...b.pairs.map((p) => p.key.length)));
  const valueW = Math.max(4, width - keyW - 2);
  return {
    node: (
      <Box flexDirection="column">
        {b.pairs.map((p, i) => (
          <Text key={i}>
            <Text color={P.faint}>{pad(p.key, keyW, false)}</Text>
            <Text color={P.fg}>{"  "}{truncate(p.value, valueW)}</Text>
          </Text>
        ))}
      </Box>
    ),
    lines: b.pairs.length,
  };
}

function buildTable(b: TableBlock, width: number): Rendered {
  const gap = 2;
  const avail = Math.max(b.columns.length * 4, width - gap * (b.columns.length - 1));
  const natural = b.columns.map((c, i) =>
    Math.max(c.length, ...b.rows.map((r) => r[i]?.length ?? 0), 4),
  );
  const naturalTotal = natural.reduce((a, n) => a + n, 0);
  const widths = natural.map((n) =>
    Math.max(4, Math.floor((n / naturalTotal) * avail)),
  );

  const renderRow = (cells: string[], color: string, bold = false) => (
    <Text color={color} bold={bold}>
      {cells.map((c, i) => pad(c, widths[i], b.align[i] === "right")).join("  ")}
    </Text>
  );

  return {
    node: (
      <Box flexDirection="column">
        {renderRow(b.columns, P.dim, true)}
        <Text color={P.rule}>
          {widths.map((w) => "─".repeat(w)).join("──")}
        </Text>
        {b.rows.map((r, i) => (
          <Box key={i}>{renderRow(r, P.fg)}</Box>
        ))}
      </Box>
    ),
    lines: 2 + b.rows.length,
  };
}

function buildCallout(b: CalloutBlock, width: number): Rendered {
  const color = VARIANT_COLOR[b.variant];
  const inner = Math.max(4, width - 2);
  const lines = wrapText(b.text, inner);
  return {
    node: (
      <Box flexDirection="column">
        {b.title ? (
          <Text>
            <Text color={color}>▌ </Text>
            <Text color={color} bold>{truncate(b.title, inner)}</Text>
          </Text>
        ) : null}
        {lines.map((l, i) => (
          <Text key={i}>
            <Text color={color}>▌ </Text>
            <Text color={P.fg}>{l || " "}</Text>
          </Text>
        ))}
      </Box>
    ),
    lines: (b.title ? 1 : 0) + lines.length,
  };
}

function buildBars(b: BarsBlock, width: number): Rendered {
  const labelW = Math.min(24, Math.max(...b.items.map((i) => i.label.length)));
  const noteW = Math.max(0, ...b.items.map((i) => (i.note ?? "").length));
  const barW = Math.max(4, width - labelW - 1 - (noteW ? noteW + 1 : 0));
  const max = b.max ?? Math.max(1, ...b.items.map((i) => i.value));
  return {
    node: (
      <Box flexDirection="column">
        {b.items.map((item, i) => {
          const filled = Math.min(barW, Math.round((item.value / max) * barW));
          return (
            <Text key={i}>
              <Text color={P.dim}>{pad(item.label, labelW, false)}</Text>
              <Text color={P.accent}>{" "}{"█".repeat(Math.max(item.value > 0 ? 1 : 0, filled))}</Text>
              <Text color={P.rule}>{"░".repeat(Math.max(0, barW - Math.max(item.value > 0 ? 1 : 0, filled)))}</Text>
              {item.note ? <Text color={P.faint}>{" "}{item.note}</Text> : null}
            </Text>
          );
        })}
      </Box>
    ),
    lines: b.items.length,
  };
}

function buildColumns(b: ColumnsBlock, width: number): Rendered {
  const gap = 2;
  const avail = width - gap * (b.columns.length - 1);
  const totalWeight = b.columns.reduce((a, c) => a + c.weight, 0);
  const widths = b.columns.map((c) =>
    Math.max(10, Math.floor((c.weight / totalWeight) * avail)),
  );
  const rendered = b.columns.map((c, i) => buildBlocks(c.blocks, widths[i]));
  return {
    node: (
      <Box flexDirection="row">
        {rendered.map((r, i) => (
          <Box
            key={i}
            flexDirection="column"
            width={widths[i]}
            marginRight={i < rendered.length - 1 ? gap : 0}
            flexShrink={0}
          >
            {r.node}
          </Box>
        ))}
      </Box>
    ),
    lines: Math.max(...rendered.map((r) => r.lines)),
  };
}

function buildCitations(b: CitationsBlock, width: number): Rendered {
  let lines = 1;
  let used = 0;
  for (const c of b.items) {
    const w = c.label.length + 6;
    if (used + w > width && used > 0) {
      lines++;
      used = 0;
    }
    used += w;
  }
  return {
    node: (
      <Box flexWrap="wrap">
        {b.items.map((c, i) => (
          <Text key={i} wrap="truncate">
            <Text color={P.faint}>‹</Text>
            <Text color={SOURCE_COLOR[c.source]}>● </Text>
            <Text color={P.dim}>{c.label}</Text>
            <Text color={P.faint}>›{"  "}</Text>
          </Text>
        ))}
      </Box>
    ),
    lines,
  };
}

function buildBlock(block: Block, width: number): Rendered {
  switch (block.type) {
    case "heading":
      return buildHeading(block, width);
    case "text":
      return buildText(block, width);
    case "list":
      return buildList(block, width);
    case "kv":
      return buildKv(block, width);
    case "table":
      return buildTable(block, width);
    case "callout":
      return buildCallout(block, width);
    case "bars":
      return buildBars(block, width);
    case "columns":
      return buildColumns(block, width);
    case "divider":
      return {
        node: block.label ? (
          <Text color={P.rule}>
            {"─".repeat(Math.max(1, Math.floor((width - block.label.length - 2) / 2)))}
            <Text color={P.faint}> {block.label} </Text>
            {"─".repeat(Math.max(1, Math.ceil((width - block.label.length - 2) / 2)))}
          </Text>
        ) : (
          <Text color={P.rule}>{"─".repeat(Math.max(1, width))}</Text>
        ),
        lines: 1,
      };
    case "citations":
      return buildCitations(block, width);
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function buildBlocks(blocks: Block[], width: number): Rendered {
  let total = 0;
  const nodes = blocks.map((b, i) => {
    const r = buildBlock(b, width);
    const last = i === blocks.length - 1;
    total += r.lines + (last ? 0 : 1);
    return (
      <Box key={i} flexDirection="column" marginBottom={last ? 0 : 1} flexShrink={0}>
        {r.node}
      </Box>
    );
  });
  return { node: <>{nodes}</>, lines: total };
}

export function measureBlocks(blocks: Block[], width: number): number {
  return buildBlocks(blocks, width).lines;
}

export function BlockRenderer({ blocks, width }: { blocks: Block[]; width: number }) {
  return <Box flexDirection="column">{buildBlocks(blocks, width).node}</Box>;
}
