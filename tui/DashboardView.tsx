import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type { Post } from "../shared/post.ts";
import type { MarketsSnapshot } from "../shared/market.ts";
import type { UptimeSnapshot, MonitorStatus } from "../shared/uptime.ts";
import type { SummaryRecord, Theme, Sentiment as SentimentData } from "../shared/summary.ts";
import { P, sourceOf } from "./theme.ts";
import { relativeTime, fmtClock, fmtCount } from "./format.ts";
import { PaneTicker } from "./Ticker.tsx";
import { Cite } from "./Cite.tsx";

const KICKER_COLOR: Record<string, string> = {
  MACRO: P.news,
  MARKET: P.news,
  INCIDENT: P.down,
  ALERT: P.down,
  DEV: P.x,
  TECH: P.x,
};

function Panel({
  icon,
  iconColor,
  title,
  meta,
  focus,
  width,
  flexGrow,
  children,
}: {
  icon?: string;
  iconColor?: string;
  title: string;
  meta?: string;
  focus?: boolean;
  width?: number;
  flexGrow?: number;
  children: ReactNode;
}) {
  const cw = Math.max(4, (width ?? 0) - 4);
  return (
    <Box
      flexDirection="column"
      width={width}
      flexGrow={flexGrow}
      minHeight={0}
      borderStyle="round"
      borderColor={focus ? P.accent : P.rule}
      paddingX={1}
      overflow="hidden"
    >
      <Box>
        {icon && <Text color={iconColor ?? P.faint}>{icon} </Text>}
        <Text color={focus ? P.white : P.dim} bold>
          {title}
        </Text>
        <Box flexGrow={1} />
        {meta && <Text color={P.faint}>{meta}</Text>}
      </Box>
      {width ? <Text color={P.rule}>{"─".repeat(cw)}</Text> : null}
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}

function MiniTheme({ theme }: { theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={KICKER_COLOR[theme.kicker] ?? P.faint} bold>
          {theme.kicker}{" "}
        </Text>
        <Text color={P.fg} bold>
          {theme.title}
        </Text>
      </Text>
      <Text color={P.dim} wrap="wrap">
        {theme.body}
      </Text>
      {theme.citations.length > 0 && (
        <Box flexWrap="wrap">
          {theme.citations.map((c, j) => (
            <Cite key={j} c={c} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function Sentiment({ sentiment, width }: { sentiment: SentimentData; width: number }) {
  const total = Math.max(1, sentiment.pos + sentiment.neu + sentiment.neg);
  const barW = Math.max(6, width);
  const pos = Math.round((sentiment.pos / total) * barW);
  const neg = Math.round((sentiment.neg / total) * barW);
  const neu = Math.max(0, barW - pos - neg);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={P.faint}>SENTIMENT</Text>
      <Text wrap="truncate">
        <Text color={P.up}>{"█".repeat(pos)}</Text>
        <Text color={P.faint}>{"█".repeat(neu)}</Text>
        <Text color={P.down}>{"█".repeat(neg)}</Text>
      </Text>
      <Box>
        <Text color={P.up}>pos {sentiment.pos}</Text>
        <Box flexGrow={1} />
        <Text color={P.faint}>neu {sentiment.neu}</Text>
        <Box flexGrow={1} />
        <Text color={P.down}>neg {sentiment.neg}</Text>
      </Box>
    </Box>
  );
}

function SummaryHero({
  summary,
  regenerating,
  newSince,
  index,
  total,
  width,
  now,
}: {
  summary: SummaryRecord | null;
  regenerating: boolean;
  newSince: number;
  index: number;
  total: number;
  width: number;
  now: number;
}) {
  const cw = Math.max(8, width - 4);
  const viewingOlder = index > 0;
  const meta = regenerating
    ? "writing …"
    : !summary
      ? undefined
      : viewingOlder
        ? `◂ ${index + 1}/${total} · ${relativeTime(summary.generated_at, now)} ago`
        : `${fmtClock(Date.parse(summary.window_start))}–${fmtClock(Date.parse(summary.window_end))} · ${relativeTime(summary.generated_at, now)} ago`;

  return (
    <Panel icon="✦" iconColor={P.accent} title="SUMMARY" meta={meta} focus width={width}>
      {!summary ? (
        <Text color={P.faint}>
          {regenerating ? "writing first digest …" : "no digest yet — press r to generate"}
        </Text>
      ) : summary.status === "empty" ? (
        <Text color={P.faint}>
          ◦ quiet window — {summary.item_count} items, nothing rose above the noise floor.
        </Text>
      ) : (
        <>
          <Text wrap="wrap">
            <Text color={P.accent}>TL;DR </Text>
            <Text color={P.fg}>{summary.digest.tldr}</Text>
          </Text>
          <Box marginTop={1} flexDirection="column">
            {summary.digest.themes.map((t, i) => (
              <Box key={i} marginBottom={1}>
                <MiniTheme theme={t} />
              </Box>
            ))}
          </Box>
          <Box flexGrow={1} />
          <Sentiment sentiment={summary.digest.sentiment} width={cw} />
          {!viewingOlder && newSince > 0 ? (
            <Text color={P.news} wrap="truncate">
              ⟳ {newSince} new since digest · <Text color={P.fg}>r</Text> regenerate
            </Text>
          ) : (
            <Text color={P.faint} wrap="truncate">
              cites {summary.item_count} items · <Text color={P.dim}>r</Text> regenerate
              {total > 1 ? " · ←/→ history" : ""}
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

function CompactPost({ post, now }: { post: Post; now: number }) {
  const src = sourceOf(post) === "news" ? P.news : P.x;
  const name = post.author_handle
    ? `@${post.author_handle.replace(/^@/, "")}`
    : post.author_name;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={src}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Box>
        <Text color={P.fg} wrap="truncate">
          {name}{" "}
        </Text>
        <Text color={P.faint}>{relativeTime(post.created_at, now)}</Text>
        <Box flexGrow={1} />
        <Text color={P.faint}>♥ {fmtCount(post.metrics.likes)}</Text>
      </Box>
      <Text color={P.dim} wrap="truncate">
        {post.text.replace(/\s+/g, " ").trim()}
      </Text>
    </Box>
  );
}

function PostsWidget({ posts, width, now }: { posts: Post[]; width: number; now: number }) {
  const top = [...posts]
    .sort((a, b) => b.metrics.views - a.metrics.views || b.metrics.likes - a.metrics.likes)
    .slice(0, 3);
  return (
    <Panel icon="X" iconColor={P.x} title="TOP POSTS" meta="by reach" width={width} flexGrow={1}>
      {top.length === 0 ? (
        <Text color={P.faint}>no posts yet</Text>
      ) : (
        top.map((p) => <CompactPost key={p.id} post={p} now={now} />)
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

export function DashboardView({
  summary,
  newSince,
  index,
  total,
  posts,
  markets,
  uptime,
  regenerating,
  width,
  height,
  now,
}: {
  summary: SummaryRecord | null;
  newSince: number;
  index: number;
  total: number;
  posts: Post[];
  markets: MarketsSnapshot | null;
  uptime: UptimeSnapshot | null;
  regenerating: boolean;
  width: number;
  height: number;
  now: number;
}) {
  const railWidth = width >= 100 ? 40 : width >= 78 ? 32 : 0;
  const heroWidth = width - 2 - (railWidth ? railWidth + 1 : 0);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Box flexDirection="row" flexGrow={1} minHeight={0}>
        <SummaryHero
          summary={summary}
          regenerating={regenerating}
          newSince={newSince}
          index={index}
          total={total}
          width={heroWidth}
          now={now}
        />
        {railWidth > 0 && (
          <Box flexDirection="column" width={railWidth} marginLeft={1} minHeight={0}>
            <MarketWidget markets={markets} width={railWidth} />
            <PostsWidget posts={posts} width={railWidth} now={now} />
            <AlertsWidget uptime={uptime} width={railWidth} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
