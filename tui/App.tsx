import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import type { Post } from "../shared/post.ts";
import { fetchFeed } from "./api.ts";
import { consolidateThreads } from "./threads.ts";
import { pickWindow } from "./layout.ts";
import { fmtClock } from "./format.ts";
import { sourceOf, P } from "./theme.ts";
import { TopBar } from "./TopBar.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { FeedItem } from "./FeedItem.tsx";
import { DetailPane } from "./DetailPane.tsx";
import { openInBrowser } from "./browser.ts";

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
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(false);
  const [buffer, setBuffer] = useState(0);
  const [now, setNow] = useState(Date.now());

  const seenRef = useRef<Set<string>>(new Set());
  const freshRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Post[] | null>(null);
  const firstLoadRef = useRef(true);
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
      const res = await fetchFeed({ baseUrl, minScore, newsOnly, limit });
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
  }, [baseUrl, minScore, newsOnly, limit, apply]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), pollMs);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load, pollMs]);

  const selectedIndex = useMemo(() => {
    const i = cards.findIndex((c) => c.key === selectedId);
    return i >= 0 ? i : 0;
  }, [cards, selectedId]);

  useEffect(() => {
    if (cards.length === 0) return;
    if (!cards.some((c) => c.key === selectedId)) setSelectedId(cards[0].key);
  }, [cards, selectedId]);

  const detailWidth = columns >= 80 ? Math.min(46, Math.floor(columns * 0.36)) : 0;
  const feedWidth = columns - detailWidth;
  const bodyRows = Math.max(3, rows - 2);
  const feedRows = Math.max(1, bodyRows - 1);

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

  const select = useCallback(
    (index: number) => {
      if (cards.length === 0) return;
      const clamped = Math.max(0, Math.min(cards.length - 1, index));
      setSelectedId(cards[clamped].key);
    },
    [cards],
  );

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
      } else if (input === "j" || key.downArrow) {
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
      } else if (input === "r") {
        void load();
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
      <TopBar
        width={columns}
        online={online}
        count={cards.length}
        newsOnly={newsOnly}
        minScore={minScore}
        clock={fmtClock(now)}
      />

      <Box height={bodyRows} width={columns}>
        <Box flexDirection="column" width={feedWidth} height={bodyRows}>
          <Box height={1} paddingX={1}>
            {showPill ? (
              <Text color={P.accent}>▲ {newCount} new — g to jump</Text>
            ) : paused ? (
              <Text color={P.news}>
                ⏸ paused · {buffer} buffered — space to resume
              </Text>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexDirection="column" overflow="hidden">
            {visible.length === 0 ? (
              <Box paddingX={1}>
                <Text color={P.faint}>
                  {online
                    ? "no posts match the current filters."
                    : `cannot reach API at ${baseUrl}`}
                </Text>
              </Box>
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
        </Box>

        {detailWidth > 0 && (
          <DetailPane card={selectedCard} width={detailWidth} height={bodyRows} now={now} />
        )}
      </Box>

      <StatusBar
        width={columns}
        xCount={xCount}
        newsCount={newsCount}
        buffer={buffer}
        stream={stream}
      />
    </Box>
  );
}
