import type { Indicator } from "./state";
import type { ChatMessage, Part, PartData, Session } from "./types";

export type ToolData = Extract<PartData, { type: "tool-call" }>;

export interface SubInfo {
  session: Session;
  indicator: Indicator;
}

/** The open session's neighbours in the subagent tree. */
export interface SessionLinks {
  parent?: Session;
  subs: SubInfo[];
}

const FOOTER = /\n*\[subagent session (ses_[\w-]+);[^\]]*\]\s*$/;

/** valet-agent's tool is `subagent`; a harness may prefix it (`mcp__valet__subagent`). */
export const isSubagentCall = (d: ToolData): boolean => /(^|[^a-z])subagent$/i.test(d.name);

const inputOf = (d: ToolData): { prompt?: string; title?: string; session?: string } =>
  typeof d.input === "object" && d.input !== null ? (d.input as Record<string, string>) : {};

/** The child session a finished (or continued) call names: the input's `session`, the result's meta, or the footer valet-agent appends to the reply. */
function namedSession(d: ToolData): string | undefined {
  const given = inputOf(d).session;
  if (typeof given === "string" && given !== "") return given;
  const meta = (d.result as { meta?: { sessionId?: unknown } } | undefined)?.meta?.sessionId;
  if (typeof meta === "string") return meta;
  return FOOTER.exec(d.output ?? "")?.[1];
}

/**
 * Binds each subagent call in a chat to its child session. Calls that name their session bind to it. A call
 * still running names none yet, so it takes the oldest unclaimed child created since it started.
 */
export function bindSubs(messages: ChatMessage[], subs: SubInfo[]): Map<string, SubInfo> {
  const byId = new Map(subs.map((s) => [s.session.id, s]));
  const calls: { part: Part; d: ToolData }[] = [];
  for (const { parts } of messages)
    for (const part of parts)
      if (part.data.type === "tool-call" && isSubagentCall(part.data)) calls.push({ part, d: part.data });
  const bound = new Map<string, SubInfo>();
  const claimed = new Set<string>();
  for (const { part, d } of calls) {
    const id = namedSession(d);
    const sub = id === undefined ? undefined : byId.get(id);
    if (sub !== undefined) {
      bound.set(part.id, sub);
      claimed.add(sub.session.id);
    }
  }
  const free = subs
    .filter((s) => !claimed.has(s.session.id))
    .sort((a, b) => a.session.createdAt - b.session.createdAt);
  for (const { part, d } of calls) {
    if (bound.has(part.id) || namedSession(d) !== undefined) continue;
    const at = free.findIndex((s) => s.session.createdAt >= part.createdAt);
    const [sub] = at < 0 ? [] : free.splice(at, 1);
    if (sub !== undefined) bound.set(part.id, sub);
  }
  return bound;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Card title: the child's own title, else the call's title, else the start of its prompt. */
export function subagentTitle(d: ToolData, sub: SubInfo | undefined): string {
  const { title, prompt } = inputOf(d);
  const text =
    sub?.session.title ?? (typeof title === "string" ? title : typeof prompt === "string" ? prompt : "");
  const line = oneLine(text);
  if (line === "") return "Subagent";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}

/** Card preview: the child's reply once there is one, else the prompt it was given. */
export function subagentPreview(d: ToolData): string {
  const reply = oneLine((d.output ?? "").replace(FOOTER, ""));
  if (reply !== "") return reply;
  const { prompt } = inputOf(d);
  return typeof prompt === "string" ? oneLine(prompt) : "";
}

export const subCount = (n: number): string => `${n} sub${n === 1 ? "" : "s"}`;
