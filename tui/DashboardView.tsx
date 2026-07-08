import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import type { MarketsSnapshot } from "../shared/market.ts";
import type { UptimeSnapshot, MonitorStatus } from "../shared/uptime.ts";
import type { ReportRecord } from "../shared/report.ts";
import type { Insight, InsightStatus } from "../shared/kb.ts";
import { P } from "./theme.ts";
import { relativeTime, fmtClock, wrapText, clampLines } from "./format.ts";
import { PaneTicker } from "./Ticker.tsx";
import { Panel } from "./Panel.tsx";

const KICKER_COLOR: Record<string, string> = {
  MACRO: P.news,
  MARKET: P.news,
  INCIDENT: P.down,
  ALERT: P.down,
  DEV: P.x,
  TECH: P.x,
};

type MdLine =
  | {
      kind: "heading";
      kicker: string;
      title: string;
      collapsed?: boolean;
      hidden?: number;
      current?: boolean;
    }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string }
  | { kind: "blank" };

// Minimal renderer for the day report's Markdown dialect: "## KICKER — headline"
// sections, bullets, and paragraphs. Inline emphasis markers are stripped —
// styling comes from the line kind, not from Markdown syntax.
function mdToLines(markdown: string, width: number): MdLine[] {
  const out: MdLine[] = [];
  const plain = (s: string) => s.replace(/\*\*?/g, "").trim();
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (out.length && out[out.length - 1].kind !== "blank") out.push({ kind: "blank" });
      continue;
    }
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      const m = /^([A-Z]{2,12})\s*[—–-]\s*(.*)$/.exec(plain(heading[1]));
      out.push(
        m
          ? { kind: "heading", kicker: m[1], title: m[2] }
          : { kind: "heading", kicker: "", title: plain(heading[1]) },
      );
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      for (const [i, w] of wrapText(plain(bullet[1]), Math.max(8, width - 2)).entries()) {
        out.push({ kind: "bullet", text: i === 0 ? `▪ ${w}` : `  ${w}` });
      }
      continue;
    }
    for (const w of wrapText(plain(line), width)) out.push({ kind: "text", text: w });
  }
  while (out.length && out[out.length - 1].kind === "blank") out.pop();
  return out;
}

function sectionBodyCounts(lines: MdLine[]): number[] {
  const counts: number[] = [];
  let section = -1;
  for (const ln of lines) {
    if (ln.kind === "heading") {
      section++;
      counts.push(0);
      continue;
    }
    if (section >= 0) counts[section]++;
  }
  return counts;
}

// Drops body lines belonging to collapsed sections and decorates each heading
// with its fold state plus whether it's the section `z`/`Z` currently target.
// `headingAt[s]` is the visible-line index of section s's heading, used to
// jump straight to it — the section cursor is deliberately independent of
// scroll position, since scroll clamps to avoid trailing blank space and so
// can never reach a heading short enough to already fit on screen.
function applyCollapse(
  lines: MdLine[],
  bodyCounts: number[],
  collapsed: Set<number>,
  cursor: number,
): { lines: MdLine[]; headingAt: number[] } {
  const out: MdLine[] = [];
  const headingAt: number[] = [];
  let section = -1;
  for (const ln of lines) {
    if (ln.kind === "heading") {
      section++;
      const isCollapsed = collapsed.has(section);
      headingAt.push(out.length);
      out.push({
        ...ln,
        collapsed: isCollapsed,
        hidden: isCollapsed ? bodyCounts[section] : 0,
        current: section === cursor,
      });
      continue;
    }
    if (section >= 0 && collapsed.has(section)) continue;
    out.push(ln);
  }
  return { lines: out, headingAt };
}

function MarkdownBody({ lines, keyOffset, width }: { lines: MdLine[]; keyOffset: number; width: number }) {
  return (
    <Box flexDirection="column" width={width} overflow="hidden">
      {lines.map((ln, i) => {
        const key = keyOffset + i;
        if (ln.kind === "blank") return <Text key={key}> </Text>;
        if (ln.kind === "heading") {
          return (
            <Text key={key} wrap="truncate">
              <Text color={ln.current ? P.accent : P.faint}>{ln.collapsed ? "▸ " : "▾ "}</Text>
              {ln.kicker ? (
                <Text color={KICKER_COLOR[ln.kicker] ?? P.accent} bold>
                  {ln.kicker}{" "}
                </Text>
              ) : null}
              <Text color={P.fg} bold>
                {ln.title}
              </Text>
              {ln.collapsed && ln.hidden ? <Text color={P.faint}> ({ln.hidden} hidden)</Text> : null}
            </Text>
          );
        }
        return (
          <Text key={key} color={ln.kind === "bullet" ? P.dim : P.fg} wrap="truncate">
            {ln.text}
          </Text>
        );
      })}
    </Box>
  );
}

function ReportHero({
  report,
  newSince,
  index,
  total,
  width,
  height,
  now,
}: {
  report: ReportRecord | null;
  newSince: number;
  index: number;
  total: number;
  width: number;
  height: number;
  now: number;
}) {
  const { isRawModeSupported } = useStdin();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [scroll, setScroll] = useState(0);
  const [sectionCursor, setSectionCursor] = useState(0);

  useEffect(() => {
    setCollapsed(new Set());
    setScroll(0);
    setSectionCursor(0);
  }, [report?.day]);

  const cw = Math.max(8, width - 4);
  const viewingOlder = index > 0;
  const meta = !report
    ? undefined
    : viewingOlder
      ? `◂ ${report.day}`
      : `${report.day} · rev ${report.revision} · updated ${relativeTime(report.updated_at, now)} ago`;

  const tldrLines = report ? clampLines(report.tldr, cw - 6, 3) : [];
  const rawLines = report ? mdToLines(report.markdown, cw) : [];
  const bodyCounts = sectionBodyCounts(rawLines);
  const totalSections = bodyCounts.length;
  const cursor = totalSections > 0 ? Math.min(sectionCursor, totalSections - 1) : -1;
  const { lines: allLines, headingAt } = applyCollapse(rawLines, bodyCounts, collapsed, cursor);

  const panelOverhead = 4; // border top/bottom + title row + rule row
  const content = Math.max(3, height - panelOverhead);
  const viewport = Math.max(1, content - tldrLines.length - 1 /* gap */ - 1 /* footer */);
  const maxScroll = Math.max(0, allLines.length - viewport);
  const top = Math.min(scroll, maxScroll);
  const shown = allLines.slice(top, top + viewport);
  const below = allLines.length - (top + shown.length);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setScroll((s) => s + 1);
      } else if (input === "k" || key.upArrow) {
        setScroll((s) => Math.max(0, s - 1));
      } else if (key.pageDown) {
        setScroll((s) => s + 10);
      } else if (key.pageUp) {
        setScroll((s) => Math.max(0, s - 10));
      } else if (input === "g") {
        setScroll(0);
      } else if (input === "G") {
        setScroll(Number.MAX_SAFE_INTEGER);
      } else if (input === "]" && totalSections > 0) {
        const next = Math.min(totalSections - 1, cursor + 1);
        setSectionCursor(next);
        setScroll(headingAt[next]);
      } else if (input === "[" && totalSections > 0) {
        const prev = Math.max(0, cursor - 1);
        setSectionCursor(prev);
        setScroll(headingAt[prev]);
      } else if (input === "z") {
        if (cursor < 0) return;
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          return next;
        });
      } else if (input === "Z") {
        setCollapsed((prev) =>
          prev.size > 0 ? new Set() : new Set(Array.from({ length: totalSections }, (_, i) => i)),
        );
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  const scrollHints = [
    top > 0 ? "↑ more" : "",
    below > 0 ? `${below} more ↓` : "",
    top > 0 || below > 0 ? "j/k scroll" : "",
    totalSections > 1 ? "[/] section" : "",
    totalSections > 0 ? "z fold" : "",
  ].filter(Boolean);

  return (
    <Panel icon="✦" iconColor={P.accent} title="DAY REPORT" meta={meta} focus width={width}>
      {!report ? (
        <Text color={P.faint}>no report yet — the next /pragyan-tick pass starts today's</Text>
      ) : (
        <>
          <Box flexDirection="column">
            {tldrLines.map((ln, i) => (
              <Text key={i} wrap="truncate">
                {i === 0 ? <Text color={P.accent}>TL;DR </Text> : null}
                <Text color={P.fg}>{ln}</Text>
              </Text>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column" height={viewport} overflow="hidden">
            <MarkdownBody lines={shown} keyOffset={top} width={cw} />
          </Box>
          {!viewingOlder && newSince > 0 ? (
            <Text color={P.news} wrap="truncate">
              ⟳ {newSince} new since update
              {scrollHints.length ? " · " + scrollHints.join(" · ") : " · next /pragyan-tick pass folds them in"}
            </Text>
          ) : (
            <Text color={P.faint} wrap="truncate">
              cites {report.item_count} posts
              {[...(total > 1 ? ["←/→ days"] : []), ...scrollHints].map((s) => ` · ${s}`).join("")}
            </Text>
          )}
        </>
      )}
    </Panel>
  );
}

function MarketWidget({ markets, width }: { markets: MarketsSnapshot | null; width: number }) {
  const rows = markets ? [...markets.crypto, ...markets.indices].slice(0, 4) : [];
  return (
    <Panel icon="$" iconColor={P.up} title="MARKETS" meta={markets?.stale ? "stale" : "live"} width={width} flexGrow={1}>
      {rows.length === 0 ? (
        <Text color={P.faint}>markets …</Text>
      ) : (
        rows.map((t) => <PaneTicker key={t.symbol} t={t} width={width - 4} />)
      )}
    </Panel>
  );
}

const LEVEL: Record<string, { label: string; color: string }> = {
  up: { label: "ok ", color: P.up },
  down: { label: "err", color: P.down },
  unknown: { label: "?? ", color: P.news },
};

function AlertsWidget({ uptime, width }: { uptime: UptimeSnapshot | null; width: number }) {
  const monitors: MonitorStatus[] = uptime?.monitors ?? [];
  const down = monitors.filter((m) => m.state === "down");
  return (
    <Panel
      icon="▲"
      iconColor={down.length ? P.news : P.faint}
      title="ALERTS & LOGS"
      meta={down.length ? `${down.length} active` : `${monitors.length} ok`}
      width={width}
      flexGrow={1}
    >
      {monitors.length === 0 ? (
        <Text color={P.faint}>no monitors</Text>
      ) : (
        <>
          {down.length ? (
            <Text wrap="truncate">
              <Text color={P.news}>▲ {down[0].name} </Text>
              <Text color={P.faint}>
                {down.length > 1 ? `+${down.length - 1} more` : "monitoring"}
              </Text>
            </Text>
          ) : (
            <Text color={P.up} wrap="truncate">
              ● all systems nominal
            </Text>
          )}
          {monitors.slice(0, 3).map((m) => {
            const lvl = LEVEL[m.state] ?? LEVEL.unknown;
            return (
              <Text key={m.name} wrap="truncate">
                <Text color={P.faint}>
                  {m.last_checked ? fmtClock(Date.parse(m.last_checked)) : "--:--:--"}{" "}
                </Text>
                <Text color={lvl.color}>{lvl.label} </Text>
                <Text color={P.dim}>
                  {m.name}
                  {m.latency_ms != null ? ` · ${m.latency_ms}ms` : ""}
                </Text>
              </Text>
            );
          })}
        </>
      )}
    </Panel>
  );
}

const INSIGHT_DOT: Record<InsightStatus, string> = {
  pending: P.news,
  approved: P.up,
  rejected: P.down,
  acted: P.accent,
};

function IntelWidget({ insights, width }: { insights: Insight[]; width: number }) {
  const pending = insights.filter((i) => i.status === "pending").length;
  const topInsights = insights.slice(0, 3);
  return (
    <Panel
      icon="✦"
      iconColor={pending ? P.news : P.faint}
      title="INSIGHTS"
      meta={pending ? `${pending} pending` : `${insights.length} total`}
      width={width}
      flexGrow={1}
    >
      {topInsights.length === 0 ? (
        <Text color={P.faint}>no insights yet.</Text>
      ) : (
        topInsights.map((i) => (
          <Text key={i.id} wrap="truncate">
            <Text color={INSIGHT_DOT[i.status] ?? P.faint}>● </Text>
            <Text color={P.fg}>{i.title}</Text>
          </Text>
        ))
      )}
    </Panel>
  );
}

export function DashboardView({
  report,
  newSince,
  index,
  total,
  markets,
  uptime,
  insights,
  width,
  height,
  now,
}: {
  report: ReportRecord | null;
  newSince: number;
  index: number;
  total: number;
  markets: MarketsSnapshot | null;
  uptime: UptimeSnapshot | null;
  insights: Insight[];
  width: number;
  height: number;
  now: number;
}) {
  const railWidth = width >= 100 ? 40 : width >= 78 ? 32 : 0;
  const heroWidth = width - 2 - (railWidth ? railWidth + 1 : 0);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Box flexDirection="row" flexGrow={1} minHeight={0}>
        <ReportHero
          report={report}
          newSince={newSince}
          index={index}
          total={total}
          width={heroWidth}
          height={height}
          now={now}
        />
        {railWidth > 0 && (
          <Box flexDirection="column" width={railWidth} marginLeft={1} minHeight={0}>
            <MarketWidget markets={markets} width={railWidth} />
            <IntelWidget insights={insights} width={railWidth} />
            <AlertsWidget uptime={uptime} width={railWidth} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
