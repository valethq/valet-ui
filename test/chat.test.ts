import { describe, expect, test } from "bun:test";
import type { SessionView } from "../src/app/state";
import type { ChatMessage, Message, Part, PartData, Session } from "../src/app/types";
import {
  copyText,
  createChat,
  fileNode,
  quietStatus,
  reasoningStatus,
  stripAnsi,
  toolStatus,
  toolStatusClass,
} from "../src/app/views/chat";

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

describe("copyText", () => {
  const textPart = (text: string): Part =>
    toolPart({}, { type: "text", data: { type: "text", text } as PartData });
  const msg = (role: "user" | "assistant", parts: Part[]): ChatMessage => ({
    message: { ...baseMessage, role },
    parts,
  });
  const baseMessage = {
    id: "m",
    sessionId: "s",
    seq: 1,
    authorPrincipalId: null,
    runId: null,
    status: "complete",
    origin: null,
    meta: {},
    createdAt: 1,
    updatedAt: 1,
  } as Message;

  test("a model message copies only the text after its last tool call", () => {
    const cm = msg("assistant", [
      textPart("Let me check."),
      toolPart(),
      textPart("Done."),
      textPart("All good."),
    ]);
    expect(copyText(cm)).toBe("Done.\n\nAll good.");
  });

  test("reasoning before the answer is left out", () => {
    const reasoning = toolPart(
      {},
      { type: "reasoning", data: { type: "reasoning", text: "hm" } as PartData },
    );
    expect(copyText(msg("assistant", [reasoning, textPart("Answer")]))).toBe("Answer");
  });

  test("a message with no trailing text has nothing to copy", () => {
    expect(copyText(msg("assistant", [textPart("Looking."), toolPart()]))).toBe("");
  });

  test("a user message copies all its text", () => {
    expect(copyText(msg("user", [textPart("one"), textPart("two")]))).toBe("one\n\ntwo");
  });
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

  test("a step of a second or less shows no time", () => {
    expect(toolStatus(toolPart({ result: { meta: { exitCode: 0 } } }, { updatedAt: 2_000 }))).toBe(
      "done · exit 0",
    );
    expect(toolStatus(toolPart({ status: "error" }, { updatedAt: 1_500 }))).toBe("error");
    expect(toolStatus(toolPart({ status: "running" }, { createdAt: Date.now() }))).toBe("running");
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

describe("reasoningStatus", () => {
  const reasoning = (over: Partial<Part> = {}): Part =>
    toolPart({}, { type: "reasoning", data: { type: "reasoning", text: "hmm" }, ...over });

  test("a streaming reasoning step shows a live timer", () => {
    expect(reasoningStatus(reasoning({ status: "streaming" }))).toMatch(/^thinking \d+:\d{2}$/);
  });

  test("a finished reasoning step shows only its run time once quietStatus runs", () => {
    expect(quietStatus(reasoningStatus(reasoning()))).toBe("0:12");
    expect(reasoningStatus(reasoning({ status: "error" }))).toBe("error · 0:12");
  });

  test("a reasoning step of a second or less shows no time", () => {
    const short = (over: Partial<Part> = {}) => reasoning({ updatedAt: 2_000, ...over });
    expect(quietStatus(reasoningStatus(short()))).toBe("");
    expect(reasoningStatus(short({ status: "error" }))).toBe("error");
    expect(reasoningStatus(reasoning({ updatedAt: 2_000, status: "streaming", createdAt: Date.now() }))).toBe(
      "thinking",
    );
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
  readonly listeners = new Map<string, ((ev: unknown) => void)[]>();
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatch(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  remove(): void {
    const i = this.#parent?.children.indexOf(this) ?? -1;
    if (i >= 0) this.#parent?.children.splice(i, 1);
    this.#parent = null;
  }
  replaceChildren(...kids: unknown[]): void {
    this.children.length = 0;
    this.append(...kids);
  }
  insertBefore(node: FakeEl, ref: FakeEl | null): void {
    node.remove();
    node.#parent = this;
    const i = ref === null ? -1 : this.children.indexOf(ref);
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
  }
  readonly nodeType = 1;
  get tagName(): string {
    return this.tag.toUpperCase();
  }
  get childNodes(): FakeEl[] {
    return this.children as FakeEl[];
  }
  get attributes(): { name: string; value: string }[] {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  getAttributeNames(): string[] {
    return [...this.attrs.keys()];
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  replaceWith(n: FakeEl): void {
    this.#parent?.insertBefore(n, this);
    this.remove();
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

function findTag(node: FakeEl, tag: string): FakeEl | undefined {
  if (node.tag === tag) return node;
  for (const c of node.children) {
    if (c instanceof FakeEl) {
      const hit = findTag(c, tag);
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
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
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
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
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

describe("message entrance", () => {
  test("only newly seen messages animate, and cached nodes stay in place", () => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    const realNow = Date.now;
    let t = 1_000_000;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    Date.now = () => t;
    try {
      const root = new FakeEl("div");
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const note = (id: string, text: string): ChatMessage => ({
        message: { ...message, id },
        parts: [
          toolPart(
            {},
            { id: `p_${id}`, messageId: id, type: "notice", data: { type: "notice", level: "error", text } },
          ),
        ],
      });
      const show = (...msgs: ChatMessage[]): FakeEl[] => {
        chat.update({ ...viewWith([]), messages: msgs }, []);
        return (findByClass(root, "messages") as FakeEl).children as FakeEl[];
      };
      const cls = (n: FakeEl | undefined): string => n?.attrs.get("class") ?? "";

      const [first] = show(note("m1", "a"));
      expect(cls(first)).toBe("msg assistant fade");
      t += 1_000;
      const [same, added] = show(note("m1", "a"), note("m2", "b"));
      expect(same).toBe(first as FakeEl);
      expect(cls(added)).toBe("msg assistant enter");
      t += 100;
      const [, resumed] = show(note("m1", "a"), note("m2", "bb"));
      expect(resumed).toBe(added as FakeEl);
      expect(cls(resumed)).toBe("msg assistant enter");
      t += 1_000;
      const [kept, settled] = show(note("m1", "a"), note("m2", "bbb"));
      expect(kept).toBe(first as FakeEl);
      expect(cls(settled)).toBe("msg assistant");
    } finally {
      g.document = savedDocument;
      Date.now = realNow;
    }
  });
});

describe("streaming updates", () => {
  test("a changed message is patched in place, keeping the hovered row's summary", () => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      const root = new FakeEl("div");
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const reasoning = (text: string): Part => ({
        id: "prt_r",
        messageId: "msg_1",
        idx: 0,
        status: "streaming",
        type: "reasoning",
        data: { type: "reasoning", text },
        createdAt: 1,
        updatedAt: 1,
      });
      chat.update(viewWith([reasoning("a")]), []);
      const summary = findTag(root, "summary");
      const row = findByClass(root, "part-row");
      chat.update(viewWith([reasoning("ab")]), []);
      expect(findTag(root, "summary")).toBe(summary as FakeEl);
      expect(findByClass(root, "part-row")).toBe(row as FakeEl);
    } finally {
      g.document = savedDocument;
    }
  });
});

describe("composer attachments", () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const withDom = (run: () => Promise<void>): (() => Promise<void>) => {
    return async () => {
      const g = globalThis as Record<string, unknown>;
      const saved = g.document;
      g.document = { createElement: (tag: string) => new FakeEl(tag) };
      try {
        await run();
      } finally {
        g.document = saved;
      }
    };
  };

  test(
    "pasted files upload, then send as file parts with the text",
    withDom(async () => {
      const root = new FakeEl("div");
      const sent: unknown[] = [];
      createChat(root as unknown as HTMLElement, {
        onSend: (parts) => {
          sent.push(parts);
          return Promise.resolve(true);
        },
        onUpload: (file) => Promise.resolve(`blb_${file.name}`),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const textarea = findTag(root, "textarea") as FakeEl;
      const row = findByClass(root, "attach-row") as FakeEl;
      textarea.value = "see attached";
      const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
      const txt = new File(["notes"], "notes.pdf", { type: "application/pdf" });
      textarea.dispatch("paste", { clipboardData: { files: [png, txt] }, preventDefault() {} });
      expect(row.style.display).toBe("");
      expect(row.children.length).toBe(2);
      expect((row.children[0] as FakeEl).children[0]).toBeInstanceOf(FakeEl);
      expect(((row.children[0] as FakeEl).children[0] as FakeEl).tag).toBe("img");

      (findByClass(root, "send") as FakeEl).dispatch("click", {});
      await tick();
      expect(sent).toEqual([
        [
          { type: "text", text: "see attached" },
          { type: "file", blobId: "blb_a.png", name: "a.png", mime: "image/png" },
          { type: "file", blobId: "blb_notes.pdf", name: "notes.pdf", mime: "application/pdf" },
        ],
      ]);
      expect(row.style.display).toBe("none");
      expect(textarea.value).toBe("");
    }),
  );

  test(
    "a file alone can be sent without text",
    withDom(async () => {
      const root = new FakeEl("div");
      const sent: unknown[] = [];
      createChat(root as unknown as HTMLElement, {
        onSend: (parts) => {
          sent.push(parts);
          return Promise.resolve(true);
        },
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const textarea = findTag(root, "textarea") as FakeEl;
      const file = new File(["x"], "x.bin");
      textarea.dispatch("paste", { clipboardData: { files: [file] }, preventDefault() {} });
      (findByClass(root, "send") as FakeEl).dispatch("click", {});
      await tick();
      expect(sent).toEqual([
        [{ type: "file", blobId: "blb_1", name: "x.bin", mime: "application/octet-stream" }],
      ]);
    }),
  );

  test(
    "a failed upload drops the chip and shows the error",
    withDom(async () => {
      const root = new FakeEl("div");
      createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.reject(new Error("disk full")),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const textarea = findTag(root, "textarea") as FakeEl;
      textarea.dispatch("paste", {
        clipboardData: { files: [new File(["x"], "x.txt")] },
        preventDefault() {},
      });
      await tick();
      expect((findByClass(root, "send-error") as FakeEl).textContent).toBe("disk full");
      expect((findByClass(root, "attach-row") as FakeEl).style.display).toBe("none");
    }),
  );

  test(
    "a file over 20 MB is refused without uploading",
    withDom(async () => {
      const root = new FakeEl("div");
      const uploads: string[] = [];
      createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: (file) => {
          uploads.push(file.name);
          return Promise.resolve("blb_1");
        },
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      const big = { name: "big.bin", size: 21 * 1024 * 1024, type: "" } as unknown as File;
      (findTag(root, "textarea") as FakeEl).dispatch("paste", {
        clipboardData: { files: [big] },
        preventDefault() {},
      });
      expect(uploads).toEqual([]);
      expect((findByClass(root, "send-error") as FakeEl).textContent).toBe("big.bin is larger than 20 MB");
    }),
  );

  test(
    "text paste without files is left to the browser",
    withDom(async () => {
      const root = new FakeEl("div");
      createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession() {},
      });
      let prevented = false;
      (findTag(root, "textarea") as FakeEl).dispatch("paste", {
        clipboardData: { files: [] },
        preventDefault() {
          prevented = true;
        },
      });
      expect(prevented).toBe(false);
      expect((findByClass(root, "attach-row") as FakeEl).style.display).toBe("none");
    }),
  );
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

describe("file parts", () => {
  test("a non-image file renders as a download button that saves the blob under its name", async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { document: g.document, fetch: g.fetch, URL: g.URL };
    const clicked: FakeEl[] = [];
    g.document = {
      createElement: (tag: string) => {
        const node = new FakeEl(tag);
        if (tag === "a") Object.assign(node, { click: () => clicked.push(node) });
        return node;
      },
    };
    g.fetch = async () => new Response("zipbytes");
    g.URL = Object.assign(function URLStub() {}, { createObjectURL: () => "blob:test-url" });
    try {
      const node = fileNode({
        type: "file",
        blobId: "blb_dl",
        name: "out/report.zip",
        mime: "application/zip",
      });
      const button = node as unknown as FakeEl;
      expect(button.tag).toBe("button");
      expect(button.attrs.get("class")).toBe("part-file");
      expect(findByClass(button, "icon")).toBeDefined();
      expect(button.children.map((c) => (c as FakeEl).textContent).includes("out/report.zip")).toBe(true);
      button.dispatch("click", {});
      await new Promise((r) => setTimeout(r, 0));
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.attrs.get("download")).toBe("out/report.zip");
      expect(clicked[0]?.attrs.get("href")).toBe("blob:test-url");
    } finally {
      Object.assign(g, saved);
    }
  });

  test("an image file still renders inline", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      const node = fileNode({ type: "file", blobId: "blb_img", name: "a.png", mime: "image/png" });
      expect((node as unknown as FakeEl).tag).toBe("img");
    } finally {
      g.document = saved;
    }
  });
});

describe("subagent sessions", () => {
  const withDom = (
    fn: (root: FakeEl, chat: ReturnType<typeof createChat>, opened: string[]) => void,
  ): void => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      const root = new FakeEl("div");
      const opened: string[] = [];
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onToggleNav() {},
        onOpenSession: (id) => opened.push(id),
      });
      fn(root, chat, opened);
    } finally {
      g.document = saved;
    }
  };
  const child = {
    ...session,
    id: "ses_c1",
    title: "Audit queue",
    parentSessionId: "ses_p",
    createdAt: 2_000,
  };
  const text = (n: FakeEl | undefined): string =>
    n === undefined
      ? ""
      : n.children.map((c) => (c instanceof FakeEl ? text(c) : String(c))).join("") + n.textContent;

  test("a subagent call renders as a card that opens its child, not as a tool row", () => {
    withDom((root, chat) => {
      const part = toolPart({
        name: "subagent",
        input: { prompt: "audit it" },
        output: 'All clear.\n\n[subagent session ses_c1; pass it as "session" to continue this subagent]',
      });
      chat.update(viewWith([part]), [], undefined, undefined, {
        subs: [{ session: child, indicator: "running" }],
      });
      expect(findByClass(root, "part-row")).toBeUndefined();
      const card = findByClass(root, "sub-card") as FakeEl;
      expect(text(findByClass(card, "sub-title"))).toBe("Audit queue");
      expect(text(findByClass(card, "sub-preview"))).toBe("All clear.");
      expect((findByClass(card, "dot") as FakeEl).attrs.get("class")).toBe("dot running");
      expect((findByClass(card, "sub-open") as FakeEl).attrs.get("data-open-session")).toBe("ses_c1");
    });
  });

  test("a call whose child is gone is a card without an open button", () => {
    withDom((root, chat) => {
      chat.update(viewWith([toolPart({ name: "subagent", input: { prompt: "x" } })]), []);
      expect(findByClass(root, "sub-card")).toBeDefined();
      expect(findByClass(root, "sub-open")).toBeUndefined();
    });
  });

  test("the card follows its child's status", () => {
    withDom((root, chat) => {
      const part = toolPart({ name: "subagent", input: { prompt: "x" }, output: "ok" });
      const show = (indicator: "running" | "done") =>
        chat.update(viewWith([part]), [], undefined, undefined, { subs: [{ session: child, indicator }] });
      show("running");
      expect((findByClass(root, "dot") as FakeEl).attrs.get("class")).toBe("dot running");
      show("done");
      expect((findByClass(root, "dot") as FakeEl).attrs.get("class")).toBe("dot done");
    });
  });

  test("a child's header shows the subagent tag and a breadcrumb to its parent", () => {
    withDom((root, chat, opened) => {
      const parent = { ...session, id: "ses_p", title: "Parent chat" };
      const view = { ...viewWith([]), session: child };
      chat.update(view, [], undefined, undefined, { parent, subs: [] });
      const crumb = findByClass(root, "crumb") as FakeEl;
      expect(crumb.style.display).toBe("");
      expect(text(findByClass(crumb, "crumb-text"))).toBe("Parent chat");
      crumb.dispatch("click", {});
      expect(opened).toEqual(["ses_p"]);
      const tag = (findByClass(root, "title-line") as FakeEl).children[2] as FakeEl;
      expect(tag.style.display).toBe("");

      chat.update(viewWith([]), [], undefined, undefined, { subs: [] });
      expect(crumb.style.display).toBe("none");
      expect(tag.style.display).toBe("none");
    });
  });
});
