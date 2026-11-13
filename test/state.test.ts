import { describe, expect, test } from "bun:test";
import {
  applyDelta,
  applyMessageComplete,
  applyMessageCreate,
  applyRunEnd,
  applyRunStart,
  newSessionView,
  upsertSession,
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
});

describe("upsertSession", () => {
  test("sorts by lastMessageAt desc and replaces in place", () => {
    let list = [session({ id: "a", createdAt: 1 })];
    list = upsertSession(list, session({ id: "b", createdAt: 2 }));
    list = upsertSession(list, session({ id: "a", createdAt: 1, lastMessageAt: 5 }));
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
