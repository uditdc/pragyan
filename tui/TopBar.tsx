import { P } from "./theme.ts";
import { Bar, type Seg } from "./Bar.tsx";

export const TABS = ["dashboard", "feed", "markets", "uptime", "chat", "projects"] as const;

const TITLE_STOPS = [P.accent, P.x, P.log];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function gradient(text: string, stops: string[]): Seg[] {
  const rgb = stops.map(hexToRgb);
  const chars = [...text];
  return chars.map((ch, i) => {
    const span = (chars.length > 1 ? i / (chars.length - 1) : 0) * (rgb.length - 1);
    const lo = Math.min(rgb.length - 2, Math.floor(span));
    const f = span - lo;
    const c = [0, 1, 2]
      .map((k) => Math.round(rgb[lo][k] + (rgb[lo + 1][k] - rgb[lo][k]) * f))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    return { t: i < chars.length - 1 ? `${ch} ` : ch, c: `#${c}`, bold: true };
  });
}

interface Props {
  width: number;
  online: boolean;
  clock: string;
  tabIdx: number;
}

export function TopBar({ width, online, clock, tabIdx }: Props) {
  const left = gradient("PRAGYAN", TITLE_STOPS);

  const center: Seg[] = [];
  TABS.forEach((name, i) => {
    const active = i === tabIdx;
    center.push({ t: `${i + 1} `, c: active ? P.accent : P.faint });
    center.push({ t: `${name}  `, c: active ? P.fg : P.faint, bold: active });
  });

  const right: Seg[] = [
    { t: `${clock}   `, c: P.faint },
    { t: online ? "● " : "○ ", c: online ? P.accent : P.down },
    { t: online ? "LIVE" : "OFFLINE", c: P.dim },
  ];

  return <Bar width={width} left={left} center={center} right={right} />;
}
