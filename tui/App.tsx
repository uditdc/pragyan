import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import type { FeedSort, Post } from "../shared/post.ts";
import {
  fetchFeed,
  postViewed,
  postDismiss,
  postUndismiss,
  fetchSummaries,
  regenerateSummary,
  fetchInsights,
  approveInsight,
  rejectInsight,
} from "./api.ts";
import type { SummaryRecord } from "../shared/summary.ts";
import { consolidateThreads } from "./threads.ts";
import { pickWindow } from "./layout.ts";
import { fmtClock } from "./format.ts";
import { sourceOf, P } from "./theme.ts";
import { config } from "./config.ts";
import { TopBar, TABS } from "./TopBar.tsx";
import { MatrixRain } from "./MatrixRain.tsx";
import { DashboardView } from "./DashboardView.tsx";
import { Panel } from "./Panel.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { FeedItem } from "./FeedItem.tsx";
import { DetailPane } from "./DetailPane.tsx";
import { openInBrowser } from "./browser.ts";
import { fetchMarkets } from "./markets.ts";
import type { MarketsSnapshot } from "../shared/market.ts";
import { MarketView } from "./MarketView.tsx";
import { UptimeView } from "./UptimeView.tsx";
import { fetchUptime, recheckUptime } from "./uptime.ts";
import type { UptimeSnapshot } from "../shared/uptime.ts";
import { InsightsView } from "./InsightsView.tsx";
import { KbReader } from "./KbReader.tsx";
import type { Insight } from "../shared/kb.ts";

const THRESHOLDS = [0, 0.2, 0.4, 0.6];

interface Props {
  baseUrl: string;
  pollMs: number;
  limit: number;
  initialThresholdIdx: number;
}

function useTerminalSize() {
  const [size, setSize] = useState({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({ rows: process.stdout.rows || 24, columns: process.stdout.columns || 80 });
    process.stdout.on("resize", onResize);
    return () => void process.stdout.off("resize", onResize);
  }, []);
  return size;
}

export function App({ baseUrl, pollMs, limit, initialThresholdIdx }: Props) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { rows, columns } = useTerminalSize();

  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [thresholdIdx, setThresholdIdx] = useState(initialThresholdIdx);
  const [newsOnly, setNewsOnly] = useState(false);
  const [sort, setSort] = useState<FeedSort>("recent");
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(false);
  const [buffer, setBuffer] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [frame, setFrame] = useState(0);
  const [tabIdx, setTabIdx] = useState(TABS.indexOf("feed"));
  const [markets, setMarkets] = useState<MarketsSnapshot | null>(null);
  const [uptime, setUptime] = useState<UptimeSnapshot | null>(null);
  const [summaries, setSummaries] = useState<SummaryRecord[]>([]);
  const [summaryNew, setSummaryNew] = useState(0);
  const [summaryIdx, setSummaryIdx] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightIdx, setInsightIdx] = useState(0);
  const [reader, setReader] = useState(false);
  const [readerScroll, setReaderScroll] = useState(0);

  const seenRef = useRef<Set<string>>(new Set());
  const freshRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Post[] | null>(null);
  const firstLoadRef = useRef(true);
  const viewedPendingRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<string[][]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const minScore = THRESHOLDS[thresholdIdx];
  const cards = useMemo(() => consolidateThreads(posts), [posts]);

  const apply = useCallback((next: Post[]) => {
    const fresh = new Set<string>();
    if (!firstLoadRef.current) {
      for (const p of next) if (!seenRef.current.has(p.id)) fresh.add(p.id);
    }
    firstLoadRef.current = false;
    freshRef.current = fresh;
    for (const p of next) seenRef.current.add(p.id);
    setPosts(next);
    setBuffer(0);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchFeed({ baseUrl, minScore, newsOnly, limit, sort });
      setOnline(true);
      if (pausedRef.current) {
        pendingRef.current = res.posts;
        setBuffer(res.posts.filter((p) => !seenRef.current.has(p.id)).length);
      } else {
        apply(res.posts);
      }
    } catch {
      setOnline(false);
    }
  }, [baseUrl, minScore, newsOnly, limit, sort, apply]);

  const loadMarkets = useCallback(async () => {
    try {
      setMarkets(await fetchMarkets(baseUrl));
    } catch {
      /* keep last snapshot; TopBar already reflects offline */
    }
  }, [baseUrl]);

  const loadUptime = useCallback(async () => {
    try {
      setUptime(await fetchUptime(baseUrl));
    } catch {
      /* keep last snapshot */
    }
  }, [baseUrl]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchSummaries(baseUrl);
      setSummaries(res.summaries);
      setSummaryNew(res.new_since);
    } catch {
      /* keep last digest */
    }
  }, [baseUrl]);

  const loadInsights = useCallback(async () => {
    try {
      setInsights(await fetchInsights(baseUrl));
    } catch {
      /* keep last */
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
    void loadMarkets();
    void loadUptime();
    void loadSummary();
    void loadInsights();
    const poll = setInterval(() => void load(), pollMs);
    const marketPoll = setInterval(() => void loadMarkets(), 10_000);
    const uptimePoll = setInterval(() => void loadUptime(), 15_000);
    const summaryPoll = setInterval(() => void loadSummary(), 30_000);
    const kbPoll = setInterval(() => void loadInsights(), 20_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const anim = config.matrix_rain ? setInterval(() => setFrame((f) => f + 1), 130) : null;
    return () => {
      clearInterval(poll);
      clearInterval(marketPoll);
      clearInterval(uptimePoll);
      clearInterval(summaryPoll);
      clearInterval(kbPoll);
      clearInterval(clock);
      if (anim) clearInterval(anim);
    };
  }, [load, loadMarkets, loadUptime, loadSummary, loadInsights, pollMs]);

  useEffect(() => {
    const flushViewed = () => {
      const ids = [...viewedPendingRef.current];
      if (ids.length === 0) return;
      viewedPendingRef.current.clear();
      void postViewed(baseUrl, ids).catch(() => {
        for (const id of ids) viewedPendingRef.current.add(id);
      });
    };
    const timer = setInterval(flushViewed, 3000);
    return () => {
      clearInterval(timer);
      flushViewed();
    };
  }, [baseUrl]);

  const selectedIndex = useMemo(() => {
    const i = cards.findIndex((c) => c.key === selectedId);
    return i >= 0 ? i : 0;
  }, [cards, selectedId]);

  useEffect(() => {
    if (cards.length === 0) return;
    if (!cards.some((c) => c.key === selectedId)) setSelectedId(cards[0].key);
  }, [cards, selectedId]);

  const onFeedTab = TABS[tabIdx] === "feed";
  const onDashboardTab = TABS[tabIdx] === "dashboard";
  const onUptimeTab = TABS[tabIdx] === "uptime";
  const onInsightsTab = TABS[tabIdx] === "insights";

  useEffect(() => {
    setInsightIdx((i) => Math.max(0, Math.min(i, insights.length - 1)));
  }, [insights.length]);

  useEffect(() => {
    setReader(false);
  }, [tabIdx]);

  const downServices = useMemo(
    () => (uptime?.monitors ?? []).filter((m) => m.state === "down").map((m) => m.name),
    [uptime],
  );
  const detailWidth = onFeedTab && columns >= 80 ? Math.min(46, Math.floor(columns * 0.36)) : 0;
  const feedGap = detailWidth ? 1 : 0;
  const feedPanelW = columns - 2 - detailWidth - feedGap;
  const feedWidth = Math.max(10, feedPanelW - 4);
  const bodyRows = Math.max(3, rows - 2);
  const feedRows = Math.max(1, bodyRows - 5);

  const win = pickWindow(cards, selectedIndex, start, feedRows, feedWidth);
  useEffect(() => {
    setStart((prev) => pickWindow(cards, selectedIndex, prev, feedRows, feedWidth).start);
  }, [cards, selectedIndex, feedRows, feedWidth]);

  const visible = cards.slice(win.start, win.start + win.count);
  const selectedCard = cards[selectedIndex] ?? null;
  const newCount = freshRef.current.size;
  const showPill = win.start > 0 && newCount > 0;

  const xCount = cards.filter((c) => sourceOf(c.lead) === "x").length;
  const newsCount = cards.length - xCount;
  const stream = paused ? "paused" : online ? "live" : "offline";

  const newPosts = paused ? buffer : newCount;
  useEffect(() => {
    if (!process.stdout.isTTY) return;
    const title = newPosts > 0 ? `PRAGYAN (${newPosts})` : "PRAGYAN";
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [newPosts]);

  const select = useCallback(
    (index: number) => {
      if (cards.length === 0) return;
      const clamped = Math.max(0, Math.min(cards.length - 1, index));
      const card = cards[clamped];
      for (const part of card.parts) viewedPendingRef.current.add(part.id);
      setSelectedId(card.key);
    },
    [cards],
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        exit();
        return;
      }
      if (reader) {
        if (key.escape || input === "q") setReader(false);
        else if (input === "j" || key.downArrow) setReaderScroll((s) => s + 1);
        else if (input === "k" || key.upArrow) setReaderScroll((s) => Math.max(0, s - 1));
        else if (key.pageDown || input === " ") setReaderScroll((s) => s + 10);
        else if (key.pageUp) setReaderScroll((s) => Math.max(0, s - 10));
        else if (input === "g") setReaderScroll(0);
        return;
      }
      if (key.tab) {
        const len = TABS.length;
        setTabIdx((i) => (key.shift ? (i + len - 1) % len : (i + 1) % len));
        return;
      }
      if (input === "q") {
        exit();
        return;
      }
      if (input >= "1" && input <= "9") {
        const n = Number(input) - 1;
        if (n < TABS.length) setTabIdx(n);
        return;
      }
      if (input === "r") {
        if (onDashboardTab) {
          setRegenerating(true);
          setSummaryIdx(0);
          void regenerateSummary(baseUrl)
            .then(loadSummary)
            .finally(() => setRegenerating(false));
        } else if (onUptimeTab) {
          void recheckUptime(baseUrl).then(setUptime).catch(() => {});
        } else if (onInsightsTab) {
          void loadInsights();
        } else {
          void load();
          void loadMarkets();
        }
        return;
      }
      if (onInsightsTab) {
        if (input === "j" || key.downArrow) {
          setInsightIdx((i) => Math.min(insights.length - 1, i + 1));
        } else if (input === "k" || key.upArrow) {
          setInsightIdx((i) => Math.max(0, i - 1));
        } else if (input === "a") {
          const ins = insights[insightIdx];
          if (ins && ins.status === "pending") {
            void approveInsight(baseUrl, ins.id).then(loadInsights).catch(() => {});
          }
        } else if (input === "x") {
          const ins = insights[insightIdx];
          if (ins && ins.status === "pending") {
            void rejectInsight(baseUrl, ins.id).then(loadInsights).catch(() => {});
          }
        } else if (key.return || input === "o") {
          if (insights[insightIdx]) {
            setReaderScroll(0);
            setReader(true);
          }
        }
        return;
      }
      if (onDashboardTab) {
        if (input === "h" || key.leftArrow) {
          setSummaryIdx((i) => Math.min(summaries.length - 1, i + 1));
        } else if (input === "l" || key.rightArrow) {
          setSummaryIdx((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (!onFeedTab) return;

      if (input === "j" || key.downArrow) {
        select(selectedIndex + 1);
      } else if (input === "k" || key.upArrow) {
        select(selectedIndex - 1);
      } else if (key.pageDown) {
        select(selectedIndex + Math.max(1, win.count));
      } else if (key.pageUp) {
        select(selectedIndex - Math.max(1, win.count));
      } else if (input === "g") {
        setStart(0);
        select(0);
      } else if (input === "G") {
        select(cards.length - 1);
      } else if (key.return || input === "o") {
        if (selectedCard) openInBrowser(selectedCard.lead.url);
      } else if (input === "t") {
        setThresholdIdx((i) => (i + 1) % THRESHOLDS.length);
        setStart(0);
      } else if (input === "n") {
        setNewsOnly((v) => !v);
        setStart(0);
      } else if (input === "s") {
        setSort((v) => (v === "score" ? "recent" : "score"));
        setStart(0);
      } else if (input === "x") {
        if (selectedCard) {
          const ids = selectedCard.parts.map((p) => p.id);
          const next = cards[selectedIndex + 1] ?? cards[selectedIndex - 1] ?? null;
          undoRef.current.push(ids);
          setPosts((prev) => prev.filter((p) => !ids.includes(p.id)));
          if (next) setSelectedId(next.key);
          void postDismiss(baseUrl, ids).catch(() => {});
        }
      } else if (input === "u") {
        const ids = undoRef.current.pop();
        if (ids) void postUndismiss(baseUrl, ids).then(load).catch(() => {});
      } else if (input === " ") {
        setPaused((v) => {
          const next = !v;
          if (!next && pendingRef.current) {
            apply(pendingRef.current);
            pendingRef.current = null;
          }
          return next;
        });
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {config.matrix_rain && <MatrixRain columns={columns} rows={rows} frame={frame} />}
      <TopBar width={columns} online={online} clock={fmtClock(now)} tabIdx={tabIdx} />

      {onFeedTab ? (
        <Box width={columns} height={bodyRows} paddingX={1} overflow="hidden">
          <Box flexDirection="row" flexGrow={1} minHeight={0}>
            <Panel
              title="FEED"
              meta={`${cards.length} items${newsOnly ? " · news" : ""} · ↓${sort}`}
              width={feedPanelW}
            >
              <Box height={1}>
                {showPill ? (
                  <Text color={P.accent}>▲ {newCount} new — g to jump</Text>
                ) : paused ? (
                  <Text color={P.news}>⏸ paused · {buffer} buffered — space to resume</Text>
                ) : (
                  <Text> </Text>
                )}
              </Box>
              <Box flexDirection="column" flexGrow={1} overflow="hidden">
                {visible.length === 0 ? (
                  <Text color={P.faint}>
                    {online
                      ? "no posts match the current filters."
                      : `cannot reach API at ${baseUrl}`}
                  </Text>
                ) : (
                  visible.map((card) => (
                    <FeedItem
                      key={card.key}
                      card={card}
                      width={feedWidth}
                      selected={card.key === selectedCard?.key}
                      fresh={freshRef.current.has(card.lead.id)}
                      now={now}
                    />
                  ))
                )}
              </Box>
            </Panel>

            {detailWidth > 0 && (
              <Box marginLeft={1} flexShrink={0}>
                <DetailPane card={selectedCard} width={detailWidth} now={now} />
              </Box>
            )}
          </Box>
        </Box>
      ) : onDashboardTab ? (
        <DashboardView
          summary={summaries[Math.min(summaryIdx, summaries.length - 1)] ?? null}
          newSince={summaryNew}
          index={summaries.length ? Math.min(summaryIdx, summaries.length - 1) : 0}
          total={summaries.length}
          markets={markets}
          uptime={uptime}
          insights={insights}
          regenerating={regenerating}
          width={columns}
          height={bodyRows}
          now={now}
        />
      ) : onUptimeTab ? (
        <UptimeView snapshot={uptime} width={columns} height={bodyRows} now={now} />
      ) : onInsightsTab ? (
        reader && insights[insightIdx] ? (
          <KbReader
            kind="INSIGHT"
            meta={`${insights[insightIdx].status} · ${insights[insightIdx].source_refs.length} source(s)`}
            headline={insights[insightIdx].title}
            lead={insights[insightIdx].rationale ? `why: ${insights[insightIdx].rationale}` : undefined}
            body={insights[insightIdx].body}
            provenance={insights[insightIdx].source_refs}
            scroll={readerScroll}
            width={columns}
            height={bodyRows}
          />
        ) : (
          <InsightsView
            insights={insights}
            selectedIdx={Math.min(insightIdx, Math.max(0, insights.length - 1))}
            width={columns}
            height={bodyRows}
          />
        )
      ) : (
        <MarketView markets={markets} width={columns} height={bodyRows} now={now} />
      )}

      <StatusBar
        width={columns}
        xCount={xCount}
        newsCount={newsCount}
        buffer={buffer}
        stream={stream}
        down={downServices}
        filter={onFeedTab ? { newsOnly, minScore, sort } : null}
      />
    </Box>
  );
}
