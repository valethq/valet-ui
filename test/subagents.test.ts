import { describe, expect, test } from "bun:test";
import { childrenOf, orphanChildren, rootOf, topLevel } from "../src/app/state";
import {
  bindSubs,
  isSubagentCall,
  rowState,
  type SubRow,
  subCount,
  type ToolData,
} from "../src/app/subagents";
import type { ChatMessage, Message, Part, Session } from "../src/app/types";

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  projectId: "prj_1",
  title: null,
  color: null,
  parentSessionId: null,
  status: "idle",
  settings: {},
  providerState: {},
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
  lastResponseAt: null,
  ...over,
});

const call = (id: string, data: Partial<ToolData> = {}, createdAt = 100): Part => ({
  id,
  messageId: "msg_1",
  idx: 0,
  status: "complete",
  type: "tool-call",
  data: {
    type: "tool-call",
    callId: id,
    name: "subagent",
    input: { tasks: [{ prompt: "do it" }] },
    status: "done",
    ...data,
  },
  createdAt,
  updatedAt: createdAt,
});

const chat = (runId: string | null, ...parts: Part[]): ChatMessage[] => [
  { message: { id: "msg_1", sessionId: "ses_p", seq: 1, role: "assistant", runId } as Message, parts },
];
/** A child of ses_p; `run` and `stage` are what valet-agent records on it. */
const sub = (id: string, createdAt = 200, run?: string, stage = 1, title: string | null = null) => ({
  session: session(id, {
    parentSessionId: "ses_p",
    createdAt,
    title,
    settings: run === undefined ? {} : { agent: { parentRunId: run, stage } },
  }),
  indicator: "done" as const,
});
const footer = (id: string) => `[subagent session ${id}; pass it as "session" to continue this subagent]`;
const tasks = (...t: Record<string, unknown>[]) => ({ tasks: t });
const ids = (rows: SubRow[] | undefined) => rows?.map((r) => r.sub?.session.id);

describe("session tree", () => {
  const list = [
    session("ses_p"),
    session("ses_c2", { parentSessionId: "ses_p", createdAt: 30 }),
    session("ses_c1", { parentSessionId: "ses_p", createdAt: 20 }),
    session("ses_g", { parentSessionId: "ses_c1" }),
    session("ses_x"),
  ];

  test("topLevel drops children; childrenOf lists a parent's, oldest first", () => {
    expect(topLevel(list).map((s) => s.id)).toEqual(["ses_p", "ses_x"]);
    expect(childrenOf(list, "ses_p").map((s) => s.id)).toEqual(["ses_c1", "ses_c2"]);
    expect(childrenOf(list, "ses_x")).toEqual([]);
  });

  test("rootOf walks to the top-level ancestor", () => {
    expect(rootOf(list, "ses_g")?.id).toBe("ses_p");
    expect(rootOf(list, "ses_x")?.id).toBe("ses_x");
    expect(rootOf(list, "ses_nope")).toBeUndefined();
  });

  test("rootOf survives a cycle", () => {
    const loop = [session("a", { parentSessionId: "b" }), session("b", { parentSessionId: "a" })];
    expect(rootOf(loop, "a")).toBeDefined();
  });

  test("orphanChildren makes a deleted parent's children top-level", () => {
    const after = orphanChildren(
      list.filter((s) => s.id !== "ses_p"),
      "ses_p",
    );
    expect(topLevel(after).map((s) => s.id)).toEqual(["ses_c2", "ses_c1", "ses_x"]);
    expect(after.find((s) => s.id === "ses_g")?.parentSessionId).toBe("ses_c1");
  });
});

describe("subagent calls", () => {
  test("a call is recognised by the tool's name, with or without an MCP prefix", () => {
    const named = (name: string) => call("p", { name }).data as ToolData;
    expect(isSubagentCall(named("subagent"))).toBe(true);
    expect(isSubagentCall(named("mcp__valet__subagent"))).toBe(true);
    expect(isSubagentCall(named("exec"))).toBe(false);
    expect(isSubagentCall(named("not_a_subagent_tool"))).toBe(false);
  });

  test("children bind through the run that started them, in creation order", () => {
    const part = call("p1", { status: "running", input: tasks({ prompt: "a" }, { prompt: "b" }) }, 100);
    const bound = bindSubs(chat("run_1", part), [sub("ses_b", 210, "run_1"), sub("ses_a", 200, "run_1")]);
    expect(ids(bound.get("p1"))).toEqual(["ses_a", "ses_b"]);
  });

  test("a child of another run, or of no run, is not in the card", () => {
    const part = call("p1", { status: "running" }, 100);
    const bound = bindSubs(chat("run_1", part), [sub("ses_other", 200, "run_2"), sub("ses_fork", 200)]);
    expect(ids(bound.get("p1"))).toEqual([undefined]);
  });

  test("two calls in one run: a child belongs to the last call that began before it", () => {
    const first = call("p1", { input: tasks({ prompt: "a" }) }, 100);
    const second = call("p2", { status: "running", input: tasks({ prompt: "b" }) }, 300);
    const bound = bindSubs(chat("run_1", first, second), [
      sub("ses_a", 150, "run_1"),
      sub("ses_b", 350, "run_1"),
    ]);
    expect([ids(bound.get("p1")), ids(bound.get("p2"))]).toEqual([["ses_a"], ["ses_b"]]);
  });

  test("a finished call binds the sessions its result names, by meta or by footers", () => {
    const meta = call("p1", {
      input: tasks({ prompt: "a" }, { prompt: "b" }),
      result: { content: [], meta: { sessions: [{ sessionId: "ses_a" }, { sessionId: "ses_b" }] } },
    });
    const text = call("p2", {
      input: tasks({ prompt: "c" }),
      output: `reply\n\n${footer("ses_c")}`,
    });
    const bound = bindSubs(chat(null, meta, text), [sub("ses_a", 1), sub("ses_b", 2), sub("ses_c", 3)]);
    expect([ids(bound.get("p1")), ids(bound.get("p2"))]).toEqual([["ses_a", "ses_b"], ["ses_c"]]);
  });

  test("a task that continues a session binds to it, even when that child is older", () => {
    const part = call(
      "p1",
      { status: "running", input: tasks({ prompt: "more", session: "ses_old" }, { prompt: "new" }) },
      500,
    );
    const bound = bindSubs(chat("run_2", part), [sub("ses_old", 10, "run_1"), sub("ses_new", 600, "run_2")]);
    expect(ids(bound.get("p1"))).toEqual(["ses_old", "ses_new"]);
  });

  test("rows follow stage order, and a later stage with no child yet is a row without a session", () => {
    const part = call(
      "p1",
      { status: "running", input: tasks({ prompt: "second", stage: 2 }, { prompt: "first", stage: 1 }) },
      100,
    );
    const rows = bindSubs(chat("run_1", part), [sub("ses_first", 200, "run_1", 1)]).get("p1") as SubRow[];
    expect(rows.map((r) => [r.title, r.stage, r.sub?.session.id])).toEqual([
      ["first", 1, "ses_first"],
      ["second", 2, undefined],
    ]);
    expect(rows.map((r) => rowState(r, true))).toEqual(["done", "queued"]);
    expect(rowState(rows[1] as SubRow, false)).toBe("not started");
  });

  test("a call from before `tasks` existed (a single prompt) still gets its row", () => {
    const part = call("p1", { input: { prompt: "old style" }, output: footer("ses_a") });
    const rows = bindSubs(chat(null, part), [sub("ses_a")]).get("p1") as SubRow[];
    expect(rows.map((r) => [r.title, r.sub?.session.id])).toEqual([["old style", "ses_a"]]);
  });

  test("a row's title prefers the child's own title, then the task's title, then its prompt", () => {
    const part = call("p1", {
      input: tasks({ prompt: "p one", title: "T one" }, { prompt: "Line\ntwo" }, { prompt: "x".repeat(200) }),
      output: [footer("ses_a")].join(""),
    });
    const bound = bindSubs(chat("run_1", part), [sub("ses_a", 1, "run_1", 1, "Child title")]);
    const rows = bound.get("p1") as SubRow[];
    expect(rows.map((r) => r.title.slice(0, 12))).toEqual(["Child title", "Line two", "xxxxxxxxxxxx"]);
    expect(rows[2]?.title).toHaveLength(80);
  });

  test("subCount pluralises", () => {
    expect([subCount(1), subCount(2)]).toEqual(["1 subagent", "2 subagents"]);
  });
});
