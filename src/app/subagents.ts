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
  /** The session this one was forked from, while it still exists. */
  forkedFrom?: Session;
  subs: SubInfo[];
}

/** One subagent in a call's card: what was asked, and the child session once there is one. */
export interface SubRow {
  title: string;
  stage: number;
  sub?: SubInfo;
}

interface Task {
  prompt?: string;
  title?: string;
  session?: string;
  stage: number;
}

const FOOTER = /\[subagent session (ses_[\w-]+);/g;

/** valet-agent's tool is `subagent`; a harness may prefix it (`mcp__valet__subagent`). */
export const isSubagentCall = (d: ToolData): boolean => /(^|[^a-z])subagent$/i.test(d.name);

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** The call's tasks in run order (by stage, then as listed). A call from before `tasks` existed carried a single `prompt`. */
function tasksOf(d: ToolData): Task[] {
  const input = obj(d.input);
  const raw = Array.isArray(input.tasks) ? input.tasks : text(input.prompt) ? [input] : [];
  return raw
    .map((item) => {
      const t = obj(item);
      const stage = typeof t.stage === "number" && Number.isInteger(t.stage) && t.stage >= 1 ? t.stage : 1;
      return { prompt: text(t.prompt), title: text(t.title), session: text(t.session), stage };
    })
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.stage - b.t.stage || a.i - b.i)
    .map(({ t }) => t);
}

/** Child sessions the finished call names: its result's meta, or the footer valet-agent appends to each reply. */
function namedBy(d: ToolData): string[] {
  const meta = obj(obj(d.result).meta);
  const fromMeta = Array.isArray(meta.sessions)
    ? meta.sessions.flatMap((s) => text(obj(s).sessionId) ?? [])
    : (text(meta.sessionId) ?? []);
  const fromText = [...(d.output ?? "").matchAll(FOOTER)].map((m) => m[1] as string);
  return [...new Set([fromMeta, fromText].flat())];
}

const stageOf = (s: Session): number => {
  const stage = obj(s.settings.agent).stage;
  return typeof stage === "number" ? stage : 1;
};

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function titleOf(task: Task | undefined, sub: SubInfo | undefined): string {
  const line = oneLine(sub?.session.title ?? task?.title ?? task?.prompt ?? "");
  if (line === "") return "Subagent";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}

interface Call {
  part: Part;
  d: ToolData;
  runId: string | null;
  tasks: Task[];
}

/**
 * Binds each subagent call in a chat to the rows of its card. A task that continues a session binds to it,
 * a finished call also names its children, and every other child binds through the run that started it
 * (`settings.agent.parentRunId`): it belongs to the last call of that run that began before the child did.
 */
export function bindSubs(messages: ChatMessage[], subs: SubInfo[]): Map<string, SubRow[]> {
  const byId = new Map(subs.map((s) => [s.session.id, s]));
  const calls: Call[] = [];
  for (const { message, parts } of messages)
    for (const part of parts)
      if (part.data.type === "tool-call" && isSubagentCall(part.data))
        calls.push({ part, d: part.data, runId: message.runId, tasks: tasksOf(part.data) });

  const taken = new Set<string>();
  const pools = new Map<Call, SubInfo[]>(calls.map((c) => [c, []]));
  for (const c of calls) {
    for (const id of [...namedBy(c.d), ...c.tasks.flatMap((t) => t.session ?? [])]) taken.add(id);
    for (const id of namedBy(c.d)) {
      const sub = byId.get(id);
      if (sub !== undefined) pools.get(c)?.push(sub);
    }
  }
  const order = (a: SubInfo, b: SubInfo): number =>
    a.session.createdAt - b.session.createdAt || a.session.id.localeCompare(b.session.id);
  for (const sub of [...subs].sort(order)) {
    const runId = obj(sub.session.settings.agent).parentRunId;
    if (taken.has(sub.session.id) || typeof runId !== "string") continue;
    const ofRun = calls.filter((c) => c.runId === runId);
    const owner = ofRun.filter((c) => c.part.createdAt <= sub.session.createdAt).at(-1) ?? ofRun[0];
    if (owner !== undefined) pools.get(owner)?.push(sub);
  }

  const out = new Map<string, SubRow[]>();
  for (const c of calls) {
    const own = new Set(c.tasks.flatMap((t) => t.session ?? []));
    const loose = (pools.get(c) ?? []).filter((s) => !own.has(s.session.id)).sort(order);
    const rows: SubRow[] = c.tasks.map((task) => {
      const sub = task.session === undefined ? loose.shift() : byId.get(task.session);
      return { title: titleOf(task, sub), stage: task.stage, ...(sub ? { sub } : {}) };
    });
    for (const sub of loose) rows.push({ title: titleOf(undefined, sub), stage: stageOf(sub.session), sub });
    out.set(c.part.id, rows);
  }
  return out;
}

export type RowState = "working" | "needs you" | "done" | "queued" | "not started";

/** `live` is whether the call itself is still running: a row with no child yet is then queued behind an earlier stage. */
export function rowState(row: SubRow, live: boolean): RowState {
  if (row.sub === undefined) return live ? "queued" : "not started";
  if (row.sub.indicator === "running") return "working";
  return row.sub.indicator === "attention" ? "needs you" : "done";
}

export const subCount = (n: number): string => `${n} subagent${n === 1 ? "" : "s"}`;
