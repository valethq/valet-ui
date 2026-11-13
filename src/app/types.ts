// Control-plane wire types, mirrored from @valethq/sdk (the browser bundle
// stays hermetic; these are the fields the UI reads).

export interface Project {
  id: string;
  name: string;
  workspaceDir: string;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  projectId: string;
  title: string | null;
  color: string | null;
  parentSessionId: string | null;
  status: "idle" | "running" | "archived";
  settings: SessionSettings;
  providerState: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
}

export interface SessionSettings {
  model?: { provider: string; model: string; fallbacks?: { provider: string; model: string }[] };
  [key: string]: unknown;
}

export interface Run {
  id: string;
  sessionId: string;
  triggerMessageId: string | null;
  status: "queued" | "running" | "complete" | "cancelled" | "error" | "interrupted";
  role: string;
  provider: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  /** Not part of the SDK Run row today; read defensively (usage.contextTokens). */
  usage?: Record<string, number>;
}

export interface Message {
  id: string;
  sessionId: string;
  seq: number;
  role: "user" | "assistant" | "system" | "tool";
  authorPrincipalId: string | null;
  runId: string | null;
  status: "streaming" | "complete" | "error" | "interrupted";
  origin: unknown;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type PartData =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      callId: string;
      name: string;
      title?: string;
      input: unknown;
      output?: string;
      result?: unknown;
      status: "pending" | "running" | "done" | "error" | "cancelled" | "denied";
    }
  | { type: "file"; blobId: string; name: string; mime: string }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | { type: "compaction-summary"; text: string; coversThroughSeq: number };

export interface Part {
  id: string;
  messageId: string;
  idx: number;
  status: "streaming" | "complete" | "error" | "interrupted";
  type: PartData["type"];
  data: PartData;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  message: Message;
  parts: Part[];
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface ProviderModels {
  provider: string;
  label: string;
  models: ModelInfo[];
}

// ---- WS frames (10.3) ----

export type ClientFrame =
  | { type: "sub"; topics: string[]; since?: Record<string, number> }
  | { type: "unsub"; topics: string[] }
  | { type: "ping" };

export type ServerFrame =
  | { type: "event"; topic: string; seq: number; name: string; data: unknown }
  | { type: "result"; id: string; ok: boolean; data?: unknown; error?: { code: string; message: string } }
  | { type: "gap"; topic: string }
  | { type: "pong" };

// ---- event payloads published on session:<id> / sessions:<projectId> ----

export interface MessageDelta {
  sessionId: string;
  messageId: string;
  partId: string;
  kind: "text" | "reasoning" | "tool-output";
  delta: string;
}

export interface RunStatus {
  sessionId: string;
  runId: string;
  status: string;
}

declare global {
  interface Window {
    VALET: { coreUrl: string };
  }
}
