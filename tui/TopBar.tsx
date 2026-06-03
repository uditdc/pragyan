import { P } from "./theme.ts";
import { Bar, type Seg } from "./Bar.tsx";

export const TABS = ["summary", "feed", "crypto", "markets", "polymarket", "uptime"] as const;

interface Props {
  width: number;
  online: boolean;
  count: number;
  newsOnly: boolean;
  minScore: number;
  clock: string;
  tabIdx: number;
}

export function TopBar({ width, online, count, newsOnly, minScore, clock, tabIdx }: Props) {
  const left: Seg[] = [
    { t: "◆ ", c: P.accent },
    { t: "XFEED  ", c: P.white, bold: true },
  ];
  TABS.forEach((name, i) => {
    const active = i === tabIdx;
    left.push({ t: `${i + 1} `, c: active ? P.accent : P.faint });
    left.push({ t: `${name}  `, c: active ? P.fg : P.faint, bold: active });
  });
  if (TABS[tabIdx] === "feed") {
    left.push({ t: " all ", c: newsOnly ? P.faint : P.fg });
    left.push({ t: "news ", c: newsOnly ? P.news : P.faint });
    left.push({ t: `· min ${minScore.toFixed(1)}`, c: P.faint });
  }

  const right: Seg[] = [
    { t: "● ", c: online ? P.accent : P.down },
    { t: online ? "LIVE " : "OFFLINE ", c: P.dim },
    { t: `${count} · ${clock}`, c: P.faint },
  ];
  return <Bar width={width} left={left} right={right} />;
}
