import { describe, expect, test } from "bun:test";
import type { Part, PartData } from "../src/app/types";
import { createChat, toolStatus, toolStatusClass } from "../src/app/views/chat";

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

  test("a done step with a non-zero exit is labelled failed", () => {
    const p = toolPart({ result: { meta: { exitCode: 2 } } });
    expect(toolStatus(p)).toBe("failed · exit 2 · 0:12");
  });
});

describe("toolStatusClass", () => {
  test("done with a non-zero exit and error status both map to failed", () => {
    expect(toolStatusClass(toolPart({ result: { meta: { exitCode: 2 } } }))).toBe("failed");
    expect(toolStatusClass(toolPart({ status: "error" }))).toBe("failed");
    expect(toolStatusClass(toolPart({ status: "error", result: { meta: { exitCode: 3 } } }))).toBe("failed");
  });

  test("healthy and live steps keep their raw status", () => {
    expect(toolStatusClass(toolPart({ result: { meta: { exitCode: 0 } } }))).toBe("done");
    expect(toolStatusClass(toolPart())).toBe("done");
    expect(toolStatusClass(toolPart({ status: "running" }))).toBe("running");
    expect(toolStatusClass(toolPart({ status: "denied" }))).toBe("denied");
  });
});

class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly children: unknown[] = [];
  readonly style: Record<string, string> = {};
  textContent = "";
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  append(...kids: unknown[]): void {
    this.children.push(...kids);
  }
  addEventListener(): void {}
  replaceChildren(...kids: unknown[]): void {
    this.children.length = 0;
    this.children.push(...kids);
  }
  get firstChild(): unknown {
    return this.children[0] ?? null;
  }
}

function findByClass(node: FakeEl, cls: string): FakeEl | undefined {
  if ((node.attrs.get("class") ?? "").split(" ").includes(cls)) return node;
  for (const c of node.children) {
    if (c instanceof FakeEl) {
      const hit = findByClass(c, cls);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

describe("send error line", () => {
  test("setSendError shows a persistent line cleared by null or a reconnect", () => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      const root = new FakeEl("div");
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onStop() {},
        onModel() {},
        onToggleNav() {},
      });
      const errNode = findByClass(root, "send-error") as FakeEl;
      const connNode = findByClass(root, "conn") as FakeEl;
      expect(errNode.style.display).toBe("none");
      chat.setSendError("Offline: message not sent");
      expect(errNode.textContent).toBe("Offline: message not sent");
      expect(errNode.style.display).toBe("");
      chat.setSendError(null);
      expect(errNode.style.display).toBe("none");
      chat.setSendError("boom");
      chat.setConnection(true);
      expect(errNode.style.display).toBe("none");
      expect(connNode.style.display).toBe("none");
      chat.setConnection(false);
      expect(connNode.style.display).toBe("");
    } finally {
      g.document = savedDocument;
    }
  });
});
