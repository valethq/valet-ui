import { describe, expect, test } from "bun:test";
import {
  applyDelta,
  applyMessageComplete,
  applyMessageCreate,
  applyRunEnd,
  applyRunInfo,
  applyRunStart,
  applyRunUpdate,
  applySessionState,
  EventBuffer,
  forkSource,
  newSessionView,
  queueModeOf,
  replaceMessages,
  needsUser,
  sessionIndicator,
  STALE_MS,
  timeAgo,
  titleSuffixes,
  upsertSession,
  withQueueMode,
} from "../src/app/state";
import type { ChatMessage, Message, MessageDelta, Part, PartData, Run, Session } from "../src/app/types";

const session = (over: Partial<Session> = {}): Session => ({
  id: "ses_1",
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

const message = (id: string, seq: number, over: Partial<Message> = {}): Message => ({
  id,
  sessionId: "ses_1",
  seq,
  role: "assistant",
  authorPrincipalId: null,
  runId: null,
  status: "streaming",
  origin: null,
  meta: {},
  createdAt: seq,
  updatedAt: seq,
  ...over,
});

const part = (id: string, messageId: string, idx: number, data: PartData): Part => ({
  id,
  messageId,
  idx,
  status: "streaming",
  type: data.type,
  data,
  createdAt: 1,
  updatedAt: 1,
});

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  sessionId: "ses_1",
  triggerMessageId: null,
  status: "running",
  role: "owner",
  provider: null,
  model: null,
  startedAt: 1,
  endedAt: null,
  error: null,
  ...over,
});

const delta = (over: Partial<MessageDelta> = {}): MessageDelta => ({
  sessionId: "ses_1",
  messageId: "msg_1",
  partId: "prt_1",
  kind: "text",
  delta: "",
  ...over,
});

const viewWith = (messages: ChatMessage[]) => newSessionView(session(), messages);

describe("applyDelta", () => {
  test("appends text to a known text part", () => {
    const view = viewWith([
      { message: message("msg_1", 1), parts: [part("prt_1", "msg_1", 0, { type: "text", text: "he" })] },
    ]);
    expect(applyDelta(view, delta({ delta: "llo" }))).toBe(false);
    const p = view.messages[0]?.parts[0];
    expect(p?.data).toEqual({ type: "text", text: "hello" });
  });

  test("appends output to a tool-call part", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [
          part("prt_1", "msg_1", 0, {
            type: "tool-call",
            callId: "c1",
            name: "exec",
            input: {},
            status: "running",
            output: "a",
          }),
        ],
      },
    ]);
    expect(applyDelta(view, delta({ kind: "tool-output", delta: "b" }))).toBe(false);
    const p = view.messages[0]?.parts[0];
    expect(p?.data.type === "tool-call" && p.data.output).toBe("ab");
  });

  test("creates a stub part for an unknown partId and reports it", () => {
    const view = viewWith([{ message: message("msg_1", 1), parts: [] }]);
    expect(applyDelta(view, delta({ partId: "prt_9", kind: "reasoning", delta: "think" }))).toBe(true);
    const p = view.messages[0]?.parts[0];
    expect(p?.id).toBe("prt_9");
    expect(p?.data).toEqual({ type: "reasoning", text: "think" });
    expect(p?.status).toBe("streaming");
  });

  test("reports an unknown message", () => {
    const view = viewWith([]);
    expect(applyDelta(view, delta({ messageId: "msg_x" }))).toBe(true);
  });

  test("offset equal to the local length appends", () => {
    const view = viewWith([
      { message: message("msg_1", 1), parts: [part("prt_1", "msg_1", 0, { type: "text", text: "abc" })] },
    ]);
    expect(applyDelta(view, delta({ delta: "def", offset: 3 }))).toBe(false);
    expect(view.messages[0]?.parts[0]?.data).toEqual({ type: "text", text: "abcdef" });
  });

  test("offset below the local length drops the overlap", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "abcdef" })],
      },
    ]);
    expect(applyDelta(view, delta({ delta: "cdefg", offset: 2 }))).toBe(false);
    expect(view.messages[0]?.parts[0]?.data).toEqual({ type: "text", text: "abcdefg" });
  });

  test("a fully-overlapping delta applies nothing", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "abcdef" })],
      },
    ]);
    expect(applyDelta(view, delta({ delta: "cdef", offset: 2 }))).toBe(false);
    expect(view.messages[0]?.parts[0]?.data).toEqual({ type: "text", text: "abcdef" });
  });

  test("offset ahead of the local length is a gap and refetches", () => {
    const view = viewWith([
      { message: message("msg_1", 1), parts: [part("prt_1", "msg_1", 0, { type: "text", text: "ab" })] },
    ]);
    expect(applyDelta(view, delta({ delta: "f", offset: 5 }))).toBe(true);
    expect(view.messages[0]?.parts[0]?.data).toEqual({ type: "text", text: "ab" });
  });

  test("offsets apply to tool-call output too", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [
          part("prt_1", "msg_1", 0, {
            type: "tool-call",
            callId: "c1",
            name: "exec",
            input: {},
            status: "running",
            output: "out",
          }),
        ],
      },
    ]);
    expect(applyDelta(view, delta({ kind: "tool-output", delta: "utput", offset: 1 }))).toBe(false);
    const p = view.messages[0]?.parts[0];
    expect(p?.data.type === "tool-call" && p.data.output).toBe("output");
  });

  test("a first delta with offset > 0 is a gap but keeps the stub", () => {
    const view = viewWith([{ message: message("msg_1", 1), parts: [] }]);
    expect(applyDelta(view, delta({ partId: "prt_9", delta: "x", offset: 4 }))).toBe(true);
    const p = view.messages[0]?.parts[0];
    expect(p?.id).toBe("prt_9");
    expect(p?.data).toEqual({ type: "text", text: "" });
  });

  test("a first delta with offset 0 fills the stub", () => {
    const view = viewWith([{ message: message("msg_1", 1), parts: [] }]);
    expect(applyDelta(view, delta({ partId: "prt_9", delta: "hi", offset: 0 }))).toBe(true);
    expect(view.messages[0]?.parts[0]?.data).toEqual({ type: "text", text: "hi" });
  });
});

describe("applyMessageCreate / applyMessageComplete", () => {
  test("inserts in seq order and dedupes by id", () => {
    const view = viewWith([{ message: message("msg_2", 2), parts: [] }]);
    applyMessageCreate(view, message("msg_1", 1, { role: "user" }), []);
    applyMessageCreate(view, message("msg_2", 2), []);
    expect(view.messages.map((cm) => cm.message.id)).toEqual(["msg_1", "msg_2"]);
  });

  test("marks the message and its streaming parts complete", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "hi" })],
      },
    ]);
    expect(applyMessageComplete(view, message("msg_1", 1, { status: "complete" }))).toBe(false);
    expect(view.messages[0]?.message.status).toBe("complete");
    expect(view.messages[0]?.parts[0]?.status).toBe("complete");
  });

  test("propagates error status to streaming parts", () => {
    const view = viewWith([
      { message: message("msg_1", 1), parts: [part("prt_1", "msg_1", 0, { type: "text", text: "" })] },
    ]);
    applyMessageComplete(view, message("msg_1", 1, { status: "error" }));
    expect(view.messages[0]?.parts[0]?.status).toBe("error");
  });

  test("reports an unknown message", () => {
    const view = viewWith([]);
    expect(applyMessageComplete(view, message("msg_x", 1))).toBe(true);
  });
});

describe("runs", () => {
  test("run.start sets the active run, run.end clears it and keeps usage", () => {
    const view = viewWith([]);
    applyRunStart(view, run("run_1"));
    expect(view.activeRunId).toBe("run_1");
    applyRunEnd(view, run("run_1", { status: "complete", usage: { contextTokens: 4200 } }));
    expect(view.activeRunId).toBeNull();
    expect(view.contextTokens).toBe(4200);
  });

  test("run.end for another run does not clear the active run", () => {
    const view = viewWith([]);
    applyRunStart(view, run("run_2"));
    applyRunEnd(view, run("run_1", { status: "complete" }));
    expect(view.activeRunId).toBe("run_2");
  });

  test("reopening recovers the active run from a streaming message", () => {
    const view = viewWith([
      { message: message("msg_1", 1, { status: "streaming", runId: "run_7" }), parts: [] },
    ]);
    expect(view.activeRunId).toBe("run_7");
  });

  test("run.end error is remembered by run id", () => {
    const view = viewWith([]);
    applyRunStart(view, run("run_1"));
    applyRunEnd(view, run("run_1", { status: "error", error: "boom" }));
    expect(view.runErrors.get("run_1")).toBe("boom");
  });

  test("run.update moves the context bar mid-run without touching the active run", () => {
    const view = viewWith([]);
    applyRunStart(view, run("run_1"));
    applyRunUpdate(view, run("run_1", { usage: { contextTokens: 190_700, contextWindow: 200_000 } }));
    expect(view.contextTokens).toBe(190_700);
    expect(view.contextWindow).toBe(200_000);
    expect(view.activeRunId).toBe("run_1");
    applyRunUpdate(view, run("run_1", { usage: { contextTokens: 41_800 } }));
    expect(view.contextTokens).toBe(41_800);
    expect(view.activeRunId).toBe("run_1");
  });

  test("run.update for another session is ignored", () => {
    const view = viewWith([]);
    applyRunUpdate(view, run("run_x", { sessionId: "ses_2", usage: { contextTokens: 9 } }));
    expect(view.contextTokens).toBeNull();
  });

  test("applyRunInfo seeds usage and error from a fetched run", () => {
    const view = viewWith([]);
    applyRunInfo(
      view,
      run("run_9", {
        status: "complete",
        error: "nope",
        usage: { contextTokens: 1200, contextWindow: 200000 },
      }),
    );
    expect(view.contextTokens).toBe(1200);
    expect(view.contextWindow).toBe(200000);
    expect(view.runErrors.get("run_9")).toBe("nope");
    applyRunInfo(view, run("run_8", { status: "running" }));
    expect(view.activeRunId).toBe("run_8");
  });
});

describe("replaceMessages", () => {
  test("keeps longer local text when the snapshot is a prefix of it", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "items 38 39 40 41" })],
      },
    ]);
    replaceMessages(view, [
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "items 38" })],
      },
    ]);
    const p = view.messages[0]?.parts[0];
    expect(p?.data).toEqual({ type: "text", text: "items 38 39 40 41" });
    expect(p?.status).toBe("streaming");
  });

  test("replaces when the local part is not an extension of the snapshot", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "different" })],
      },
    ]);
    replaceMessages(view, [
      {
        message: message("msg_1", 1),
        parts: [{ ...part("prt_1", "msg_1", 0, { type: "text", text: "final text" }), status: "complete" }],
      },
    ]);
    const p = view.messages[0]?.parts[0];
    expect(p?.data).toEqual({ type: "text", text: "final text" });
    expect(p?.status).toBe("complete");
  });

  test("keeps locally-streaming parts the snapshot does not know yet", () => {
    const view = viewWith([
      {
        message: message("msg_1", 1),
        parts: [
          part("prt_1", "msg_1", 0, { type: "text", text: "hello" }),
          part("prt_2", "msg_1", 1, { type: "reasoning", text: "streamed" }),
        ],
      },
    ]);
    replaceMessages(view, [
      {
        message: message("msg_1", 1),
        parts: [part("prt_1", "msg_1", 0, { type: "text", text: "hello" })],
      },
    ]);
    expect(view.messages[0]?.parts.map((p) => p.id)).toEqual(["prt_1", "prt_2"]);
  });

  test("keeps locally-known messages missing from the snapshot", () => {
    const view = viewWith([
      { message: message("msg_1", 1), parts: [] },
      {
        message: message("msg_2", 2),
        parts: [part("prt_9", "msg_2", 0, { type: "text", text: "new" })],
      },
    ]);
    replaceMessages(view, [{ message: message("msg_1", 1), parts: [] }]);
    expect(view.messages.map((cm) => cm.message.id)).toEqual(["msg_1", "msg_2"]);
  });
});

describe("upsertSession", () => {
  test("sorts by last activity desc, falling back to createdAt, and replaces in place", () => {
    let list = [session({ id: "a", createdAt: 1 })];
    list = upsertSession(list, session({ id: "b", createdAt: 2 }));
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    list = upsertSession(list, session({ id: "a", createdAt: 1, lastMessageAt: 5 }));
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
    list = upsertSession(list, session({ id: "b", createdAt: 2, lastMessageAt: 3 }));
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
    expect(list).toHaveLength(2);
  });
});

describe("titleSuffixes", () => {
  test("numbers same-title sessions after the oldest", () => {
    const sessions = [
      session({ id: "a", title: "dup", createdAt: 1 }),
      session({ id: "b", title: "dup", createdAt: 2 }),
      session({ id: "c", title: "dup", createdAt: 3 }),
      session({ id: "d", title: "solo", createdAt: 4 }),
    ];
    const m = titleSuffixes(sessions);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(3);
    expect(m.get("d")).toBeUndefined();
  });

  test("untitled sessions group together regardless of list order", () => {
    const sessions = [
      session({ id: "b", title: null, createdAt: 2 }),
      session({ id: "a", title: null, createdAt: 1 }),
    ];
    const m = titleSuffixes(sessions);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBe(2);
  });
});

describe("EventBuffer", () => {
  test("drops events when not armed, buffers in order while armed", () => {
    const buf = new EventBuffer<string>();
    expect(buf.push("s1", "a")).toBe(false);
    buf.begin("s1");
    expect(buf.push("s2", "x")).toBe(false);
    expect(buf.push("s1", "a")).toBe(true);
    expect(buf.push("s1", "b")).toBe(true);
    expect(buf.end("s1")).toEqual(["a", "b"]);
    expect(buf.push("s1", "c")).toBe(false);
  });

  test("end with a different id leaves the buffer armed", () => {
    const buf = new EventBuffer<string>();
    buf.begin("s1");
    buf.push("s1", "a");
    expect(buf.end("s2")).toEqual([]);
    expect(buf.end("s1")).toEqual(["a"]);
  });

  test("begin with a different id drops the old buffer", () => {
    const buf = new EventBuffer<string>();
    buf.begin("s1");
    buf.push("s1", "a");
    buf.begin("s2");
    expect(buf.push("s1", "b")).toBe(false);
    expect(buf.end("s2")).toEqual([]);
  });

  test("begin with the same id keeps buffered events", () => {
    const buf = new EventBuffer<string>();
    buf.begin("s1");
    buf.push("s1", "a");
    buf.begin("s1");
    buf.push("s1", "b");
    expect(buf.end("s1")).toEqual(["a", "b"]);
  });
});

describe("sessionIndicator", () => {
  const now = 10 * STALE_MS;
  const s = (over: Partial<Session> = {}) => session({ lastMessageAt: now - 1000, ...over });
  const none = { attention: false, running: false };

  test("finished, running, needs-you and stale", () => {
    expect(sessionIndicator(s(), none, now)).toBe("done");
    expect(sessionIndicator(s({ status: "running" }), none, now)).toBe("running");
    expect(sessionIndicator(s(), { attention: false, running: true }, now)).toBe("running");
    expect(sessionIndicator(s({ status: "running" }), { attention: true, running: true }, now)).toBe(
      "attention",
    );
    expect(sessionIndicator(s({ lastMessageAt: now - STALE_MS - 1 }), none, now)).toBe("stale");
  });

  test("falls back to updatedAt when there are no messages, and running is never stale", () => {
    expect(sessionIndicator(s({ lastMessageAt: null, updatedAt: now - STALE_MS - 1 }), none, now)).toBe(
      "stale",
    );
    expect(sessionIndicator(s({ status: "running", lastMessageAt: 0 }), none, now)).toBe("running");
  });

  test("needsUser spots approval and question statuses", () => {
    expect(needsUser("waiting for approval")).toBe(true);
    expect(needsUser("permission requested")).toBe(true);
    expect(needsUser("running")).toBe(false);
  });
});

describe("timeAgo", () => {
  test("compacts to now, minutes, hours and days", () => {
    const now = 10 * 86_400_000;
    expect(timeAgo(now - 20_000, now)).toBe("now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(timeAgo(now - 3 * 3_600_000 - 1, now)).toBe("3h");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d");
    expect(timeAgo(now + 5000, now)).toBe("now");
  });
});

describe("session state", () => {
  const state = { queued: 3, model: { provider: "p", model: "m" } };

  test("sets the queue depth and seeds the context meter", () => {
    const view = newSessionView(session(), []);
    applySessionState(view, { ...state, usage: { contextTokens: 900, contextWindow: 2000 } });
    expect([view.queued, view.contextTokens, view.contextWindow]).toEqual([3, 900, 2000]);
  });

  test("keeps usage a run already reported and does not revive a run that ended", () => {
    const view = newSessionView(session(), []);
    view.contextTokens = 5;
    applySessionState(view, { ...state, usage: { contextTokens: 900 } });
    expect(view.contextTokens).toBe(5);
    expect(view.activeRunId).toBeNull();
  });

  test("adopts the active run when the view has none, but never replaces one it has", () => {
    const view = newSessionView(session(), []);
    applySessionState(view, { ...state, activeRunId: "run_1" });
    expect(view.activeRunId).toBe("run_1");
    applySessionState(view, { ...state, activeRunId: "run_2" });
    expect(view.activeRunId).toBe("run_1");
    applySessionState(view, { ...state, queued: 0 });
    expect(view.queued).toBe(0);
    expect(view.activeRunId).toBe("run_1");
  });
});

describe("queue mode", () => {
  test("the session's own mode wins over the default", () => {
    expect(queueModeOf(session({ settings: { agent: { queueMode: "interrupt" } } }), "queue")).toBe(
      "interrupt",
    );
    expect(queueModeOf(session(), "interrupt")).toBe("interrupt");
    expect(queueModeOf(session({ settings: { agent: { queueMode: "bogus" } } }), "queue")).toBe("queue");
  });

  test("setting it keeps every other setting", () => {
    const settings = {
      model: { provider: "p", model: "m" },
      agent: { parentRunId: "run_1", forkedFrom: { sessionId: "ses_0" } },
    };
    expect(withQueueMode(settings, "interrupt")).toEqual({
      model: { provider: "p", model: "m" },
      agent: { parentRunId: "run_1", forkedFrom: { sessionId: "ses_0" }, queueMode: "interrupt" },
    });
    expect(withQueueMode({}, "queue")).toEqual({ agent: { queueMode: "queue" } });
  });
});

describe("forkSource", () => {
  const source = session({ id: "ses_src", title: "Original" });
  const fork = session({
    id: "ses_fork",
    settings: { agent: { forkedFrom: { sessionId: "ses_src", messageId: "m" } } },
  });

  test("finds the session a fork came from", () => {
    expect(forkSource([source, fork], fork)).toBe(source);
  });

  test("is undefined once the source is gone, or for a session that was never forked", () => {
    expect(forkSource([fork], fork)).toBeUndefined();
    expect(forkSource([source], source)).toBeUndefined();
  });
});
