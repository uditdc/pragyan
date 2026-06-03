import { P } from "./theme.ts";
import { Bar, type Seg } from "./Bar.tsx";

export type Stream = "live" | "offline" | "paused";

interface Props {
  width: number;
  xCount: number;
  newsCount: number;
  buffer: number;
  stream: Stream;
  down: string[];
}

const STREAM_LABEL: Record<Stream, string> = {
  live: "▶ LIVE",
  offline: "◌ offline",
  paused: "⏸ PAUSED",
};

const STREAM_COLOR: Record<Stream, string> = {
  live: P.accent,
  offline: P.down,
  paused: P.news,
};

export function StatusBar({ width, xCount, newsCount, buffer, stream, down }: Props) {
  const left: Seg[] = down.length
    ? [{ t: `⚠ ${down.length} DOWN: ${down.join(", ")}   `, c: P.down, bold: true }]
    : [];
  left.push(
    { t: "X ", c: P.x },
    { t: `${xCount}   `, c: P.dim },
    { t: "news ", c: P.news },
    { t: `${newsCount}   `, c: P.dim },
    { t: `buffer ${buffer}`, c: P.faint },
  );
  const right: Seg[] = [
    { t: `${STREAM_LABEL[stream]}   `, c: STREAM_COLOR[stream] },
    {
      t: "1-6 tabs · j/k move · enter open · x dismiss · u undo · space pause · t thr · n news · ←/→ digest history · r refresh/regen · q quit",
      c: P.faint,
    },
  ];
  return <Bar width={width} left={left} right={right} />;
}
