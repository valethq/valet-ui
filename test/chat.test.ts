import { describe, expect, test } from "bun:test";
import type { SessionView } from "../src/app/state";
import type { Message, Part, PartData, Session } from "../src/app/types";
import { createChat, quietStatus, stripAnsi, toolStatus, toolStatusClass } from "../src/app/views/chat";

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
  value = "";
  #parent: FakeEl | null = null;
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  append(...kids: unknown[]): void {
    for (const k of kids) if (k instanceof FakeEl) k.#parent = this;
    this.children.push(...kids);
  }
  addEventListener(): void {}
  remove(): void {
    const i = this.#parent?.children.indexOf(this) ?? -1;
    if (i >= 0) this.#parent?.children.splice(i, 1);
    this.#parent = null;
  }
  replaceChildren(...kids: unknown[]): void {
    this.children.length = 0;
    this.append(...kids);
  }
  get firstChild(): { remove(): void } | null {
    const c = this.children[0];
    if (c === undefined) return null;
    if (c instanceof FakeEl) return c;
    return {
      remove: () => {
        this.children.shift();
      },
    };
  }
  get dataset(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.attrs) {
      if (k.startsWith("data-")) {
        out[k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
      }
    }
    return out;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.startsWith(".") ? sel.slice(1) : sel;
    const out: FakeEl[] = [];
    const walk = (n: FakeEl): void => {
      for (const c of n.children) {
        if (c instanceof FakeEl) {
          if ((c.attrs.get("class") ?? "").split(" ").includes(cls)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
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
        onRename() {},
        onDelete() {},
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

describe("stripAnsi", () => {
  test("removes CSI sequences like colour resets", () => {
    expect(stripAnsi("\x1b[0m[... 120 lines omitted ...]")).toBe("[... 120 lines omitted ...]");
    expect(stripAnsi("\x1b[32mok\x1b[0m tail \x1b[1;31mbad\x1b[m")).toBe("ok tail bad");
  });

  test("removes OSC sequences closed by BEL or ST", () => {
    expect(stripAnsi("\x1b]0;window title\x07after")).toBe("after");
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\!")).toBe("link!");
  });

  test("removes a stray ESC and leaves plain text alone", () => {
    expect(stripAnsi("a\x1bb\x1b")).toBe("ab");
    expect(stripAnsi("plain [0m text")).toBe("plain [0m text");
    expect(stripAnsi("")).toBe("");
  });
});

const session: Session = {
  id: "ses_1",
  projectId: "prj_1",
  title: "T",
  color: null,
  parentSessionId: null,
  status: "idle",
  settings: {},
  providerState: {},
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
};

const message: Message = {
  id: "msg_1",
  sessionId: "ses_1",
  seq: 1,
  role: "assistant",
  authorPrincipalId: null,
  runId: null,
  status: "complete",
  origin: null,
  meta: {},
  createdAt: 1,
  updatedAt: 1,
};

const viewWith = (parts: Part[]): SessionView => ({
  session,
  messages: [{ message, parts }],
  activeRunId: null,
  runStatus: null,
  contextTokens: null,
  contextWindow: null,
  runErrors: new Map(),
});

describe("tool output rendering", () => {
  test("ANSI escapes are stripped at render time, leaving the visible text", () => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      const root = new FakeEl("div");
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
      });
      const part = toolPart({
        input: { command: "ls" },
        output: "\x1b[0m[... 120 lines omitted ...]\n\x1b[32mok\x1b[0m",
        status: "done",
      });
      chat.update(viewWith([part]), []);
      const row = findByClass(root, "part-row") as FakeEl;
      const body = findByClass(row, "body") as FakeEl;
      const pre = body.children.find((c): c is FakeEl => c instanceof FakeEl && c.tag === "pre");
      expect(pre?.children.join("")).toBe("$ ls\n[... 120 lines omitted ...]\nok");
      expect(part.data.type === "tool-call" && part.data.output).toContain("\x1b[0m");
    } finally {
      g.document = savedDocument;
    }
  });
});

describe("quietStatus", () => {
  test("drops the redundant done/complete word but keeps exit code and time", () => {
    expect(quietStatus("complete")).toBe("");
    expect(quietStatus("done · exit 0 · 0:12")).toBe("exit 0 · 0:12");
    expect(quietStatus("done · 0:12")).toBe("0:12");
    expect(quietStatus("failed · exit 2 · 0:12")).toBe("failed · exit 2 · 0:12");
    expect(quietStatus("running 0:03")).toBe("running 0:03");
  });
});
