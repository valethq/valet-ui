import type { ChatMessage, Message, MessageDelta, Part, PartData, Run, Session } from "./types";

export interface SessionView {
  session: Session;
  messages: ChatMessage[];
  activeRunId: string | null;
  runStatus: string | null;
  /** From run usage, when a run reports it. */
  contextTokens: number | null;
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
  return { session, messages, activeRunId, runStatus: null, contextTokens: null };
}

export function upsertSession(list: Session[], session: Session): Session[] {
  const next = list.filter((s) => s.id !== session.id).concat(session);
  next.sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
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

export function replaceMessages(view: SessionView, messages: ChatMessage[]): void {
  view.messages = messages;
}

export function applyRunStart(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
  view.activeRunId = run.id;
  view.runStatus = "running";
  const tokens = run.usage?.contextTokens;
  if (typeof tokens === "number") view.contextTokens = tokens;
}

export function applyRunEnd(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
  if (view.activeRunId === run.id) {
    view.activeRunId = null;
    view.runStatus = null;
  }
  const tokens = run.usage?.contextTokens;
  if (typeof tokens === "number") view.contextTokens = tokens;
}

export function applyRunStatus(view: SessionView, runId: string, status: string): void {
  if (view.activeRunId === runId || view.activeRunId === null) view.runStatus = status;
}

/** Deterministic fallback accent when the session has no color yet. */
const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#f7768e", "#73daca"];

export function sessionColor(session: Session): string {
  if (session.color !== null) return session.color;
  let h = 0;
  for (let i = 0; i < session.id.length; i++) h = (h * 31 + session.id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] as string;
}
