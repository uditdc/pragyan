import type { Metrics } from "../shared/post.ts";

export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "?";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export function relativeAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}

export function fmtClock(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtCount(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
}

export function metricsLine(m: Metrics): string {
  return `♥ ${fmtCount(m.likes)}  ⇄ ${fmtCount(m.reposts)}  ↗ ${fmtCount(m.views)}`;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let current = "";
    for (const word of rawLine.split(/(\s+)/)) {
      if (current.length + word.length <= width) {
        current += word;
      } else if (word.length > width) {
        if (current) lines.push(current);
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        current = "";
      } else {
        lines.push(current.trimEnd());
        current = word.trimStart();
      }
    }
    lines.push(current.trimEnd());
  }
  return lines.length ? lines : [""];
}

export function clampLines(text: string, width: number, max: number): string[] {
  const all = wrapText(text, width);
  if (all.length <= max) return all;
  const lines = all.slice(0, max);
  const last = lines[max - 1];
  lines[max - 1] = last.slice(0, Math.max(0, width - 1)).trimEnd() + "…";
  return lines;
}
