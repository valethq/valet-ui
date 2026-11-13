import { describe, expect, test } from "bun:test";
import type { Part, PartData } from "../src/app/types";
import { toolStatus } from "../src/app/views/chat";

type ToolData = Extract<PartData, { type: "tool-call" }>;

const toolPart = (data: Partial<ToolData> = {}, over: Partial<Part> = {}): Part => ({
  id: "prt_1",
  messageId: "msg_1",
  idx: 0,
  status: "complete",
  type: "tool-call",
  data: { type: "tool-call", callId: "c1", name: "exec", input: {}, status: "done", ...data },
  createdAt: 1_000,
  updatedAt: 13_000,
  ...over,
});

describe("toolStatus", () => {
  test("done shows the exit code and run time", () => {
    expect(toolStatus(toolPart({ result: { meta: { exitCode: 0 } } }))).toBe("done · exit 0 · 0:12");
  });

  test("error shows its exit code", () => {
    const p = toolPart({ status: "error", result: { meta: { exitCode: 3 } } }, { updatedAt: 66_000 });
    expect(toolStatus(p)).toBe("error · exit 3 · 1:05");
  });

  test("the exit code is omitted without result meta", () => {
    expect(toolStatus(toolPart())).toBe("done · 0:12");
    expect(toolStatus(toolPart({ result: "plain" }))).toBe("done · 0:12");
    expect(toolStatus(toolPart({ result: { meta: {} } }))).toBe("done · 0:12");
    expect(toolStatus(toolPart({ status: "cancelled" }))).toBe("cancelled · 0:12");
  });

  test("a running step shows a live timer", () => {
    expect(toolStatus(toolPart({ status: "running" }))).toMatch(/^running \d+:\d{2}$/);
  });

  test("a pending step stays bare and non-tool parts are empty", () => {
    expect(toolStatus(toolPart({ status: "pending" }))).toBe("pending");
    const p = toolPart({}, { type: "text", data: { type: "text", text: "hi" } });
    expect(toolStatus(p)).toBe("");
  });
});
