import type { ChatMessage, Message, MessageDelta, Part, PartData, Run, Session } from "./types";

export interface SessionView {
  session: Session;
  messages: ChatMessage[];
  activeRunId: string | null;
  runStatus: string | null;
  /** From run usage, when a run reports it. */
  contextTokens: number | null;
  /** Context window the run reported via usage.contextWindow, when known. */
  contextWindow: number | null;
  /** run.id -> run.error, remembered for error rendering. */
  runErrors: Map<string, string>;
}

export function newSessionView(session: Session, messages: ChatMessage[]): SessionView {
  // A reopened session has no REST route to the live run; recover it from a
  // still-streaming assistant message's runId (spec-gap).
  let activeRunId: string | null = null;
  for (const cm of messages) {
    if (cm.message.status === "streaming" && cm.message.runId !== null) {
      activeRunId = cm.message.runId;
    }
  }
  return {
    session,
    messages,
    activeRunId,
    runStatus: null,
    contextTokens: null,
    contextWindow: null,
    runErrors: new Map(),
  };
}

export function upsertSession(list: Session[], session: Session): Session[] {
  const next = list.filter((s) => s.id !== session.id).concat(session);
  next.sort((a, b) => b.createdAt - a.createdAt);
  return next;
}

function findMessage(view: SessionView, id: string): ChatMessage | undefined {
  return view.messages.find((cm) => cm.message.id === id);
}

export function applyMessageCreate(view: SessionView, message: Message, parts: Part[]): void {
  const existing = findMessage(view, message.id);
  if (existing) {
    existing.message = message;
    existing.parts = parts;
    return;
  }
  view.messages.push({ message, parts });
  view.messages.sort((a, b) => a.message.seq - b.message.seq);
}

function stubPart(d: MessageDelta, idx: number): Part {
  const data: PartData =
    d.kind === "text"
      ? { type: "text", text: "" }
      : d.kind === "reasoning"
        ? { type: "reasoning", text: "" }
        : { type: "tool-call", callId: d.partId, name: "tool", input: null, status: "running" };
  const now = Date.now();
  return {
    id: d.partId,
    messageId: d.messageId,
    idx,
    status: "streaming",
    type: data.type,
    data,
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns true when the delta referenced something unknown (caller refetches). */
export function applyDelta(view: SessionView, d: MessageDelta): boolean {
  const cm = findMessage(view, d.messageId);
  if (!cm) return true;
  let part = cm.parts.find((p) => p.id === d.partId);
  let unknown = false;
  if (!part) {
    // openPart emits no event; a new part announces itself via its first delta.
    unknown = true;
    part = stubPart(d, cm.parts.length === 0 ? 0 : Math.max(...cm.parts.map((p) => p.idx)) + 1);
    cm.parts.push(part);
    cm.parts.sort((a, b) => a.idx - b.idx);
  }
  if (part.data.type === "text" || part.data.type === "reasoning") {
    part.data = { ...part.data, text: part.data.text + d.delta };
  } else if (part.data.type === "tool-call") {
    part.data = { ...part.data, output: (part.data.output ?? "") + d.delta };
  }
  return unknown;
}

/** Returns true when the message was unknown (caller refetches). */
export function applyMessageComplete(view: SessionView, message: Message): boolean {
  const cm = findMessage(view, message.id);
  if (!cm) return true;
  cm.message = message;
  for (const part of cm.parts) {
    if (part.status === "streaming") part.status = message.status;
  }
  return false;
}

/** A refetched snapshot can be older than deltas already applied locally, so
 * locally-streaming content that extends the snapshot's wins, and local
 * parts/messages the snapshot doesn't know yet are kept. */
export function replaceMessages(view: SessionView, messages: ChatMessage[]): void {
  const local = new Map(view.messages.map((cm) => [cm.message.id, cm]));
  for (const cm of messages) {
    const l = local.get(cm.message.id);
    local.delete(cm.message.id);
    if (l === undefined) continue;
    const snapPartIds = new Set(cm.parts.map((p) => p.id));
    for (const p of cm.parts) {
      const lp = l.parts.find((x) => x.id === p.id);
      if (lp === undefined || lp.status !== "streaming") continue;
      if (
        (p.data.type === "text" || p.data.type === "reasoning") &&
        (lp.data.type === "text" || lp.data.type === "reasoning") &&
        lp.data.text.length > p.data.text.length &&
        lp.data.text.startsWith(p.data.text)
      ) {
        p.data = { ...p.data, text: lp.data.text };
        p.status = lp.status;
      } else if (
        p.data.type === "tool-call" &&
        lp.data.type === "tool-call" &&
        (lp.data.output ?? "").length > (p.data.output ?? "").length &&
        (lp.data.output ?? "").startsWith(p.data.output ?? "")
      ) {
        p.data = { ...p.data, output: lp.data.output };
        p.status = lp.status;
      }
    }
    for (const lp of l.parts) {
      if (lp.status === "streaming" && !snapPartIds.has(lp.id)) cm.parts.push(lp);
    }
    cm.parts.sort((a, b) => a.idx - b.idx);
  }
  for (const l of local.values()) messages.push(l);
  messages.sort((a, b) => a.message.seq - b.message.seq);
  view.messages = messages;
}

function applyUsage(view: SessionView, run: Run): void {
  const tokens = run.usage?.contextTokens;
  if (typeof tokens === "number") view.contextTokens = tokens;
  const win = run.usage?.contextWindow;
  if (typeof win === "number" && win > 0) view.contextWindow = win;
  if (typeof run.error === "string" && run.error !== "") view.runErrors.set(run.id, run.error);
}

export function applyRunStart(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
  view.activeRunId = run.id;
  view.runStatus = "running";
  applyUsage(view, run);
}

export function applyRunEnd(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
  if (view.activeRunId === run.id) {
    view.activeRunId = null;
    view.runStatus = null;
  }
  applyUsage(view, run);
}

/** Seeds the view from a fetched run row (context bar + error after reload). */
export function applyRunInfo(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
  if (run.status === "running" || run.status === "queued") view.activeRunId = run.id;
  applyUsage(view, run);
}

export function applyRunStatus(view: SessionView, runId: string, status: string): void {
  if (view.activeRunId === runId || view.activeRunId === null) view.runStatus = status;
}

/** Deterministic fallback accents when the session has no color yet. */
export const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#f7768e", "#73daca"];

/** Position of `id` in the sessions' createdAt order (oldest first). */
export function colorIndex(sessions: Session[], id: string): number {
  const i = [...sessions].sort((a, b) => a.createdAt - b.createdAt).findIndex((s) => s.id === id);
  return Math.max(i, 0);
}

export function sessionColor(session: Session, index: number): string {
  if (session.color !== null) return session.color;
  const i = ((index % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[i] as string;
}
