import { describe, expect, test } from "bun:test";
import { childrenOf, orphanChildren, rootOf, topLevel } from "../src/app/state";
import {
  bindSubs,
  isSubagentCall,
  subagentPreview,
  subagentTitle,
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
    input: { prompt: "do it" },
    status: "done",
    ...data,
  },
  createdAt,
  updatedAt: createdAt,
});

const chat = (...parts: Part[]): ChatMessage[] => [
  { message: { id: "msg_1", sessionId: "ses_p", seq: 1, role: "assistant" } as Message, parts },
];
const sub = (id: string, createdAt = 200) => ({
  session: session(id, { parentSessionId: "ses_p", createdAt }),
  indicator: "done" as const,
});
const footer = (id: string) => `\n\n[subagent session ${id}; pass it as "session" to continue this subagent]`;

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

  test("a finished call binds through the footer valet-agent appends", () => {
    const part = call("p1", { output: `all fine${footer("ses_c1")}` });
    const bound = bindSubs(chat(part), [sub("ses_c1"), sub("ses_c2")]);
    expect(bound.get("p1")?.session.id).toBe("ses_c1");
  });

  test("result.meta.sessionId and an input `session` bind too", () => {
    const meta = call("p1", { result: { content: [], meta: { sessionId: "ses_c1" } } });
    const asked = call("p2", { input: { prompt: "more", session: "ses_c2" } });
    const bound = bindSubs(chat(meta, asked), [sub("ses_c1"), sub("ses_c2")]);
    expect([bound.get("p1")?.session.id, bound.get("p2")?.session.id]).toEqual(["ses_c1", "ses_c2"]);
  });

  test("a running call takes the oldest child nobody else claimed, created after it started", () => {
    const done = call("p1", { output: `ok${footer("ses_c1")}` }, 100);
    const running = call("p2", { status: "running", output: undefined }, 150);
    const bound = bindSubs(chat(done, running), [sub("ses_c1", 120), sub("ses_c2", 160)]);
    expect(bound.get("p2")?.session.id).toBe("ses_c2");
  });

  test("a running call does not take a child that predates it", () => {
    const running = call("p1", { status: "running", output: undefined }, 500);
    expect(bindSubs(chat(running), [sub("ses_c1", 120)]).size).toBe(0);
  });

  test("a call whose child is gone binds to nothing", () => {
    const part = call("p1", { output: `ok${footer("ses_gone")}` });
    expect(bindSubs(chat(part), [sub("ses_c1")]).size).toBe(0);
  });
});

describe("card text", () => {
  const data = (over: Partial<ToolData>): ToolData => call("p", over).data as ToolData;

  test("title prefers the child's, then the call's, then the prompt", () => {
    expect(subagentTitle(data({}), { ...sub("c"), session: session("c", { title: "Audit" }) })).toBe("Audit");
    expect(subagentTitle(data({ input: { prompt: "p", title: "Named" } }), undefined)).toBe("Named");
    expect(subagentTitle(data({ input: { prompt: "Line one\nline two" } }), undefined)).toBe(
      "Line one line two",
    );
    expect(subagentTitle(data({ input: {} }), undefined)).toBe("Subagent");
    expect(subagentTitle(data({ input: { prompt: "x".repeat(200) } }), undefined)).toHaveLength(80);
  });

  test("preview is the reply without its footer, else the prompt", () => {
    expect(subagentPreview(data({ output: `Found  it.\n\nBye${footer("ses_c1")}` }))).toBe("Found it. Bye");
    expect(subagentPreview(data({ output: undefined, input: { prompt: "do\nthis" } }))).toBe("do this");
  });

  test("subCount pluralises", () => {
    expect([subCount(1), subCount(2)]).toEqual(["1 sub", "2 subs"]);
  });
});
