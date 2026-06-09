import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ChatEvent, ChatMessage, ChatTurn } from "../shared/chat.ts";
import { postChat } from "./api.ts";
import { wrapText } from "./format.ts";
import { Panel } from "./Panel.tsx";
import { BlockRenderer, measureBlocks } from "./BlockRenderer.tsx";
import { P } from "./theme.ts";

interface Props {
  baseUrl: string;
  active: boolean;
  width: number;
  height: number;
  messages: ChatTurn[];
  setMessages: Dispatch<SetStateAction<ChatTurn[]>>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  live: ChatEvent[];
  setLive: Dispatch<SetStateAction<ChatEvent[]>>;
}

const SPINNER = ["◴", "◷", "◶", "◵"];

interface Rendered {
  node: ReactNode;
  lines: number;
}

function renderTurn(turn: ChatTurn, width: number, key: number): Rendered {
  if (turn.role === "user") {
    const lines = wrapText(turn.content, Math.max(4, width - 2));
    return {
      lines: lines.length,
      node: (
        <Box key={key} flexDirection="column" flexShrink={0}>
          <Text>
            <Text color={P.accent} bold>{"❯ "}</Text>
            <Text color={P.white} bold>{lines[0]}</Text>
          </Text>
          {lines.slice(1).map((l, i) => (
            <Text key={i} color={P.white} bold>{"  "}{l}</Text>
          ))}
        </Box>
      ),
    };
  }
  if (turn.layout && turn.layout.blocks.length > 0) {
    return {
      lines: measureBlocks(turn.layout.blocks, width),
      node: (
        <Box key={key} flexDirection="column" flexShrink={0}>
          <BlockRenderer blocks={turn.layout.blocks} width={width} />
        </Box>
      ),
    };
  }
  const lines = wrapText(turn.content || "(no answer)", width);
  return {
    lines: lines.length,
    node: (
      <Box key={key} flexDirection="column" flexShrink={0}>
        {lines.map((l, i) => (
          <Text key={i} color={P.fg}>{l || " "}</Text>
        ))}
      </Box>
    ),
  };
}

export function ChatView({
  baseUrl,
  active,
  width,
  height,
  messages,
  setMessages,
  input,
  setInput,
  busy,
  setBusy,
  error,
  setError,
  live,
  setLive,
}: Props) {
  const [scroll, setScroll] = useState(0);
  const [spin, setSpin] = useState(0);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpin((s) => s + 1), 120);
    return () => clearInterval(t);
  }, [busy]);

  const submit = () => {
    const content = input.trim();
    if (!content || busy) return;
    const next: ChatTurn[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setLive([]);
    setBusy(true);
    stickRef.current = true;
    const wire: ChatMessage[] = next.map((m) => ({ role: m.role, content: m.content }));
    postChat(baseUrl, wire, (ev) => setLive((prev) => [...prev, ev]))
      .then((res) => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.reply, layout: res.layout },
        ]);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "request failed");
      })
      .finally(() => {
        setBusy(false);
        setLive([]);
      });
  };

  const innerWidth = Math.max(10, width - 6);
  const transcriptRows = Math.max(1, height - 5);

  const rendered: Rendered[] = [];
  messages.forEach((turn, i) => rendered.push(renderTurn(turn, innerWidth, i)));
  if (busy) {
    const shown = live.slice(-8);
    rendered.push({
      lines: 1 + shown.length,
      node: (
        <Box key="busy" flexDirection="column" flexShrink={0}>
          <Box>
            <Text color={P.accent}>{SPINNER[spin % SPINNER.length]} </Text>
            <Text color={P.faint}>{shown.length ? "working…" : "thinking…"}</Text>
          </Box>
          {shown.map((ev, i) => (
            <Text key={i} color={ev.kind === "done" ? P.up : P.dim}>
              {"  "}
              {ev.kind === "done" ? "✓ " : "→ "}
              {ev.label}
            </Text>
          ))}
        </Box>
      ),
    });
  }
  if (error) {
    rendered.push({
      lines: 1,
      node: (
        <Box key="error" flexShrink={0}>
          <Text color={P.down}>⚠ {error}</Text>
        </Box>
      ),
    });
  }

  const total = rendered.reduce((sum, r, i) => sum + r.lines + (i > 0 ? 1 : 0), 0);
  const maxScroll = Math.max(0, total - transcriptRows);
  const clamped = Math.min(scroll, maxScroll);

  useEffect(() => {
    if (stickRef.current) setScroll(maxScroll);
  }, [maxScroll]);

  useInput(
    (char, key) => {
      if (key.upArrow) {
        stickRef.current = false;
        setScroll((s) => Math.max(0, Math.min(s, maxScroll) - 1));
        return;
      }
      if (key.downArrow) {
        setScroll((s) => {
          const n = Math.min(maxScroll, s + 1);
          if (n >= maxScroll) stickRef.current = true;
          return n;
        });
        return;
      }
      if (key.pageUp) {
        stickRef.current = false;
        setScroll((s) => Math.max(0, Math.min(s, maxScroll) - transcriptRows));
        return;
      }
      if (key.pageDown) {
        setScroll((s) => {
          const n = Math.min(maxScroll, s + transcriptRows);
          if (n >= maxScroll) stickRef.current = true;
          return n;
        });
        return;
      }
      if (busy) return;
      if (key.return) {
        submit();
        return;
      }
      if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.escape) return;
      if (char) setInput((s) => s + char);
    },
    { isActive: active },
  );

  const meta =
    maxScroll > 0
      ? `${Math.min(100, Math.round(((clamped + transcriptRows) / total) * 100))}%`
      : "ask about your feed & summaries";

  return (
    <Box width={width} height={height} paddingX={1}>
      <Panel title="CHAT" meta={meta} width={width - 2} height={height}>
        <Box flexDirection="column" height={transcriptRows} overflow="hidden" flexShrink={0}>
          {messages.length === 0 && !busy ? (
            <Text color={P.faint}>
              type a question and press Enter — e.g. "what's been happening with AI lately?"
            </Text>
          ) : (
            <Box flexDirection="column" marginTop={-clamped} flexShrink={0}>
              {rendered.map((r, i) => (
                <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0} flexShrink={0}>
                  {r.node}
                </Box>
              ))}
            </Box>
          )}
        </Box>
        <Box height={1}>
          <Text color={P.accent}>{"› "}</Text>
          <Text color={P.fg}>
            {input}
            <Text color={P.faint}>█</Text>
          </Text>
        </Box>
      </Panel>
    </Box>
  );
}
