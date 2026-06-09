import type { Layout } from "./layout.ts";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  layout: Layout | null;
  tool_calls_made: number;
  truncated: boolean;
}

export interface ChatEvent {
  kind: "call" | "done";
  label: string;
}

export interface ChatTurn extends ChatMessage {
  layout?: Layout | null;
}
