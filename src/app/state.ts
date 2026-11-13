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

/** When a chat last had activity; falls back to creation for chats with no messages yet (same order core lists them in). */
export const sessionActivityAt = (s: Session): number => s.lastMessageAt ?? s.createdAt;

export function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => sessionActivityAt(b) - sessionActivityAt(a));
}

export function upsertSession(list: Session[], session: Session): Session[] {
  return sortSessions(list.filter((s) => s.id !== session.id).concat(session));
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

/** Returns true when the delta had a gap or referenced something unknown
 * (caller refetches). */
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
  const cur =
    part.data.type === "text" || part.data.type === "reasoning"
      ? part.data.text.length
      : part.data.type === "tool-call"
        ? (part.data.output ?? "").length
        : 0;
  let delta = d.delta;
  if (d.offset !== undefined) {
    // offset is the server-side length before this delta: ahead of `cur` is a
    // gap (refetch; keep any stub), behind it is overlap already applied.
    if (d.offset > cur) return true;
    delta = delta.slice(cur - d.offset);
    if (delta === "") return unknown;
  }
  if (part.data.type === "text" || part.data.type === "reasoning") {
    part.data = { ...part.data, text: part.data.text + delta };
  } else if (part.data.type === "tool-call") {
    part.data = { ...part.data, output: (part.data.output ?? "") + delta };
  }
  return unknown;
}

/** Replaces (or adds) one part in place. False when its message isn't in the view yet, so the caller can refetch. */
export function applyPartUpdate(view: SessionView, messageId: string, part: Part): boolean {
  const cm = findMessage(view, messageId);
  if (!cm) return false;
  const i = cm.parts.findIndex((p) => p.id === part.id);
  if (i >= 0) cm.parts[i] = part;
  else cm.parts.push(part);
  cm.parts.sort((a, b) => a.idx - b.idx);
  return true;
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

/** run.update fires on every runs.update write; its usage keeps the context
 * bar moving mid-run. */
export function applyRunUpdate(view: SessionView, run: Run): void {
  if (run.sessionId !== view.session.id) return;
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

export type Indicator = "running" | "attention" | "done" | "stale";

export const STALE_MS = 3 * 60 * 60 * 1000;

/** Sidebar/header status dot: needs-you beats running; an idle session with
 * no activity for STALE_MS goes grey, otherwise it reads as finished. */
export function sessionIndicator(
  session: Session,
  opts: { attention: boolean; running: boolean },
  now: number,
): Indicator {
  if (opts.attention) return "attention";
  if (opts.running || session.status === "running") return "running";
  return now - (session.lastMessageAt ?? session.updatedAt) > STALE_MS ? "stale" : "done";
}

/** Compact relative time for the sidebar: now, 5m, 3h, 2d. */
export function timeAgo(at: number, now: number): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** Run-status text from a provider that means it is waiting on the user. */
export const needsUser = (status: string): boolean =>
  /approv|permission|question|input|waiting|confirm/i.test(status);

/** Sessions sharing a displayed title get `#n` suffixes by createdAt order;
 * the oldest of each group stays unnumbered. */
export function titleSuffixes(sessions: Session[]): Map<string, number> {
  const byTitle = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.title ?? "Untitled";
    const group = byTitle.get(key);
    if (group === undefined) byTitle.set(key, [s]);
    else group.push(s);
  }
  const out = new Map<string, number>();
  for (const group of byTitle.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < group.length; i++) {
      const s = group[i];
      if (s !== undefined) out.set(s.id, i + 1);
    }
  }
  return out;
}

/** Buffers events for a session whose REST snapshot is still loading; the
 * buffer replays through the normal handler once the view exists. */
export class EventBuffer<E> {
  #id: string | null = null;
  #events: E[] = [];

  /** Arm the buffer for `id`; a different pending id drops the old buffer. */
  begin(id: string): void {
    if (id === this.#id) return;
    this.#id = id;
    this.#events = [];
  }

  /** Buffers `event` when `id` is the pending session; returns whether it did. */
  push(id: string, event: E): boolean {
    if (id !== this.#id) return false;
    this.#events.push(event);
    return true;
  }

  /** Disarm and drain; buffered events come back in arrival order. */
  end(id: string): E[] {
    if (id !== this.#id) return [];
    this.#id = null;
    const out = this.#events;
    this.#events = [];
    return out;
  }
}
