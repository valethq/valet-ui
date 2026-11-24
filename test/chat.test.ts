import { describe, expect, test } from "bun:test";
import type { SessionView } from "../src/app/state";
import type {
  ChatMessage,
  Message,
  Part,
  PartData,
  PartType,
  ProviderModels,
  Session,
} from "../src/app/types";
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
import { galleryItems } from "../src/app/views/lightbox";

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
  /** Stand-in for layout: tests say where each node sits and how tall the viewport is. */
  static layout: (n: FakeEl) => { top: number; bottom: number } = () => ({ top: 0, bottom: 0 });
  static viewport = 0;
  readonly attrs = new Map<string, string>();
  readonly children: unknown[] = [];
  readonly style: Record<string, string> = {};
  textContent = "";
  value = "";
  /** `<details>` reflection: `.open` is the `open` attribute. */
  get open(): boolean {
    return this.attrs.has("open");
  }
  set open(on: boolean) {
    if (on) this.attrs.set("open", "");
    else this.attrs.delete("open");
  }
  #parent: FakeEl | null = null;
  constructor(readonly tag: string) {}
  get parent(): FakeEl | null {
    return this.#parent;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  get clientHeight(): number {
    return FakeEl.viewport;
  }
  getBoundingClientRect(): { top: number; bottom: number } {
    return FakeEl.layout(this);
  }
  readonly classList = {
    add: (...names: string[]): void => {
      const cur = new Set((this.attrs.get("class") ?? "").split(" ").filter(Boolean));
      for (const n of names) cur.add(n);
      this.attrs.set("class", [...cur].join(" "));
    },
    remove: (...names: string[]): void => {
      const left = (this.attrs.get("class") ?? "").split(" ").filter((c) => !names.includes(c));
      this.attrs.set("class", left.join(" "));
    },
  };
  append(...kids: unknown[]): void {
    for (const k of kids) {
      const node = typeof k === "string" ? new FakeText(k) : k;
      if (node instanceof FakeEl) node.#parent = this;
      else if (node instanceof FakeText) node.parent = this;
      this.children.push(node);
    }
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
  insertBefore(node: FakeEl | FakeText, ref: FakeEl | FakeText | null): void {
    node.remove();
    if (node instanceof FakeEl) node.#parent = this;
    else node.parent = this;
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
  replaceWith(n: FakeEl | FakeText): void {
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

/** A stand-in Text node: `el()`'s string children land in `children`, and morph patches or replaces them. */
class FakeText {
  readonly nodeType = 3;
  parent: FakeEl | null = null;
  constructor(public data: string) {}
  appendData(s: string): void {
    this.data += s;
  }
  remove(): void {
    const i = this.parent?.children.indexOf(this) ?? -1;
    if (i >= 0) this.parent?.children.splice(i, 1);
    this.parent = null;
  }
  replaceWith(n: FakeEl | FakeText): void {
    this.parent?.insertBefore(n, this);
    this.remove();
  }
  toString(): string {
    return this.data;
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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
  lastResponseAt: null,
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
  loading: false,
  paging: null,
  queued: 0,
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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

describe("loading placeholder", () => {
  test("shows the loader instead of the empty notice until messages arrive, with the title already set", () => {
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      const loading = { ...viewWith([]), messages: [], loading: true };
      chat.update(loading, []);
      const loader = findByClass(root, "loading");
      expect(loader).toBeDefined();
      expect(findByClass(root, "empty")).toBeUndefined();
      expect(findByClass(root, "session-title")?.textContent).toBe(session.title ?? "Untitled");
      chat.update({ ...loading, loading: false }, []);
      expect(findByClass(root, "loading")).toBeUndefined();
      expect(findByClass(root, "empty")).toBeDefined();
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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

describe("render cost", () => {
  const withChat = (
    fn: (chat: ReturnType<typeof createChat>, root: FakeEl, tick: (ms: number) => void) => void,
  ): void => {
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      fn(chat, root, (ms) => {
        t += ms;
      });
    } finally {
      g.document = savedDocument;
      Date.now = realNow;
    }
  };

  test("a running step is tagged for the tick, and the passing of time alone does not re-render it", () => {
    withChat((chat, root, tick) => {
      const since = 1_000_000 - 5_000;
      const view = viewWith([
        toolPart(
          { status: "running" },
          { id: "p_run", status: "streaming", createdAt: since, updatedAt: since },
        ),
      ]);
      chat.update(view, []);
      const status = findByClass(root, "status") as FakeEl;
      expect(status.attrs.get("data-live")).toBe("running");
      expect(status.attrs.get("data-since")).toBe(String(since));
      expect(status.textContent).toBe("running 0:05");
      const row = findByClass(root, "part-row");
      tick(3_000);
      chat.update(view, []);
      expect(findByClass(root, "part-row")).toBe(row);
      expect(status.textContent).toBe("running 0:05");
    });
  });

  test("a finished step carries no live tag", () => {
    withChat((chat, root) => {
      chat.update(viewWith([toolPart()]), []);
      expect((findByClass(root, "status") as FakeEl).attrs.has("data-live")).toBe(false);
    });
  });

  test("a live step stays collapsed until it has run 750ms, then opens on the next update", () => {
    withChat((chat, root, tick) => {
      const running = (output: string): Part =>
        toolPart(
          { status: "running", output },
          { id: "p_run", status: "streaming", createdAt: 1_000_000, updatedAt: 1_000_000 },
        );
      const open = (): boolean => (findByClass(root, "part-row") as unknown as { open: boolean }).open;
      chat.update(viewWith([running("")]), []);
      expect(open()).toBe(false);
      tick(700);
      chat.update(viewWith([running("a")]), []);
      expect(open()).toBe(false);
      tick(100);
      chat.update(viewWith([running("ab")]), []);
      expect(open()).toBe(true);
    });
  });

  test("a streaming reasoning step stays collapsed until 750ms, then opens as more text lands", () => {
    withChat((chat, root, tick) => {
      const thinking = (text: string): Part =>
        toolPart(
          {},
          {
            id: "p_th",
            type: "reasoning",
            status: "streaming",
            data: { type: "reasoning", text },
            createdAt: 1_000_000,
            updatedAt: 1_000_000,
          },
        );
      const open = (): boolean => (findByClass(root, "part-row") as unknown as { open: boolean }).open;
      chat.update(viewWith([thinking("h")]), []);
      expect(open()).toBe(false);
      tick(800);
      chat.update(viewWith([thinking("hmm")]), []);
      expect(open()).toBe(true);
    });
  });

  test("an entrance lasts as long as its animation: a re-render 400ms in still resumes it", () => {
    withChat((chat, root, tick) => {
      const note = (text: string): ChatMessage => ({
        message: { ...message, id: "m1" },
        parts: [
          toolPart(
            {},
            { id: "p_m1", messageId: "m1", type: "notice", data: { type: "notice", level: "error", text } },
          ),
        ],
      });
      const list = (): FakeEl[] => (findByClass(root, "messages") as FakeEl).children as FakeEl[];
      chat.update({ ...viewWith([]), messages: [note("a")] }, []);
      tick(1_000);
      chat.update(
        { ...viewWith([]), messages: [note("a"), { ...note("b"), message: { ...message, id: "m2" } }] },
        [],
      );
      const added = list()[1] as FakeEl;
      expect(added.attrs.get("class")).toBe("msg assistant enter");
      tick(400);
      chat.update(
        { ...viewWith([]), messages: [note("a"), { ...note("bb"), message: { ...message, id: "m2" } }] },
        [],
      );
      expect((list()[1] as FakeEl).attrs.get("class")).toBe("msg assistant enter");
    });
  });
});

describe("load animation reach", () => {
  const withChat = (fn: (h: ReturnType<typeof harness>) => void): void => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    const realNow = Date.now;
    g.document = { createElement: (tag: string) => new FakeEl(tag) };
    try {
      fn(harness());
    } finally {
      g.document = savedDocument;
      Date.now = realNow;
      FakeEl.layout = () => ({ top: 0, bottom: 0 });
      FakeEl.viewport = 0;
    }
  };
  const textOf = (n: unknown): string =>
    n instanceof FakeEl ? n.textContent + n.children.map(textOf).join("") : String(n);
  function harness() {
    const root = new FakeEl("div");
    const chat = createChat(root as unknown as HTMLElement, {
      onSend: () => Promise.resolve(true),
      onUpload: () => Promise.resolve("blb_1"),
      onStop() {},
      onModel() {},
      onRename() {},
      onDelete() {},
      onFork() {},
      onMove() {},
      onCompact() {},
      onToggleNav() {},
      onOpenSession() {},
      onLoadOlder() {},
      onOpenFile: async () => true,
    });
    const note = (id: string): ChatMessage => ({
      message: { ...message, id },
      parts: [
        toolPart(
          {},
          {
            id: `p_${id}`,
            messageId: id,
            type: "notice",
            data: { type: "notice", level: "error", text: id },
          },
        ),
      ],
    });
    const show = (loading: boolean, ...msgs: ChatMessage[]): Record<string, string> => {
      chat.update({ ...viewWith([]), messages: msgs, loading }, []);
      const kids = (findByClass(root, "messages") as FakeEl).children as FakeEl[];
      return Object.fromEntries(kids.map((n) => [textOf(n), n.attrs.get("class") ?? ""]));
    };
    return { note, show };
  }

  test("on first render only messages within two screens of the bottom play the load animation", () => {
    withChat(({ note, show }) => {
      FakeEl.viewport = 800;
      // the container ends at y=800; two screens up is y=-800
      FakeEl.layout = (n) => {
        const t = textOf(n);
        if (n.attrs.get("class") === "messages") return { top: 0, bottom: 800 };
        if (t === "far") return { top: -5100, bottom: -5000 };
        if (t === "edge") return { top: -900, bottom: -700 };
        return { top: 600, bottom: 700 };
      };
      const classes = show(false, note("far"), note("edge"), note("near"));
      expect(classes.far).toBe("msg assistant");
      expect(classes.edge).toBe("msg assistant fade");
      expect(classes.near).toBe("msg assistant fade");
    });
  });

  test("a trimmed message does not pick the animation back up on the next render", () => {
    withChat(({ note, show }) => {
      FakeEl.viewport = 800;
      FakeEl.layout = (n) =>
        n.attrs.get("class") === "messages"
          ? { top: 0, bottom: 800 }
          : textOf(n) === "far"
            ? { top: -5100, bottom: -5000 }
            : { top: 600, bottom: 700 };
      show(false, note("far"), note("near"));
      const again = show(false, note("far"), note("near"), note("fresh"));
      expect(again.far).toBe("msg assistant");
      expect(again.fresh).toBe("msg assistant enter");
    });
  });

  test("history added above the first message never animates, while a new last message still does", () => {
    withChat(({ note, show }) => {
      show(false, note("m2"), note("m3"));
      const grown = show(false, note("m0"), note("m1"), note("m2"), note("m3"), note("m4"));
      expect(grown.m0).toBe("msg assistant");
      expect(grown.m1).toBe("msg assistant");
      expect(grown.m4).toBe("msg assistant enter");
    });
  });

  test("a message still receiving pieces of a long part is marked while it fills", () => {
    withChat(({ note, show }) => {
      const filling = note("m1");
      (filling.parts[0] as Part).partial = 9000;
      const during = show(false, filling, note("m2"));
      expect(during.m1).toContain("partial");
      expect(during.m2).not.toContain("partial");
      delete (filling.parts[0] as Part).partial;
      expect(show(false, filling, note("m2")).m1).not.toContain("partial");
    });
  });

  test("the loading placeholder does not use up the load animation", () => {
    withChat(({ note, show }) => {
      show(true);
      const loaded = show(false, note("m1"), note("m2"));
      expect(loaded.m1).toBe("msg assistant fade");
      expect(loaded.m2).toBe("msg assistant fade");
    });
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      const big = { name: "big.bin", size: 21 * 1024 * 1024, type: "" } as unknown as File;
      (findTag(root, "textarea") as FakeEl).dispatch("paste", {
        clipboardData: { files: [big] },
        preventDefault() {},
      });
      expect(uploads).toEqual([]);
      expect((findByClass(root, "send-error") as FakeEl).textContent).toBe("big.bin exceeds the 20 MB limit");
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
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

  test("an image file renders as a framed figure that opens the viewer and downloads", () => {
    withFakeDom(() => {
      const node = fileNode(imageData("blb_img", "a.png")) as unknown as FakeEl;
      expect(node.attrs.get("data-gallery")).toBe("Assistant");
      const figure = findTag(node, "figure") as FakeEl;
      expect(findByClass(figure, "fig-pic")?.attrs.get("data-view")).toBe("blb_img");
      expect(text(findByClass(figure, "name"))).toBe("a.png");
      const save = figure.querySelectorAll(".fig-act").find((b) => b.attrs.has("data-save"));
      expect(save?.attrs.get("data-name")).toBe("a.png");
    });
  });
});

const imageData = (blobId: string, name: string): Extract<PartData, { type: "file" }> => ({
  type: "file",
  blobId,
  name,
  mime: "image/png",
});

const filePartOf = (id: string, blobId: string, name: string): Part =>
  toolPart({}, { id, type: "file", data: imageData(blobId, name) as PartData });

const textPartOf = (id: string, body: string): Part =>
  toolPart({}, { id, type: "text", data: { type: "text", text: body } as PartData });

function withFakeDom(fn: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, fetch: g.fetch };
  g.document = { createElement: (tag: string) => new FakeEl(tag), createTextNode: (t: string) => t };
  g.fetch = () => new Promise(() => {});
  try {
    fn();
  } finally {
    Object.assign(g, saved);
  }
}

const text = (n: FakeEl | undefined): string =>
  n === undefined
    ? ""
    : n.children.map((c) => (c instanceof FakeEl ? text(c) : String(c))).join("") + n.textContent;

describe("message images", () => {
  const render = (role: "user" | "assistant", parts: Part[]): FakeEl => {
    const root = new FakeEl("div");
    const chat = createChat(root as unknown as HTMLElement, {
      onSend: () => Promise.resolve(true),
      onUpload: () => Promise.resolve("blb_1"),
      onStop() {},
      onModel() {},
      onRename() {},
      onDelete() {},
      onFork() {},
      onMove() {},
      onCompact() {},
      onToggleNav() {},
      onOpenSession() {},
      onLoadOlder() {},
      onOpenFile: async () => true,
    });
    chat.update({ ...viewWith(parts), messages: [{ message: { ...message, role }, parts }] }, []);
    return findByClass(root, "messages") as FakeEl;
  };

  test("a user's images are dealt into one deck above the text, in order", () => {
    withFakeDom(() => {
      const list = render("user", [
        filePartOf("p1", "blb_a", "a.png"),
        textPartOf("p2", "look at these"),
        filePartOf("p3", "blb_b", "b.png"),
      ]);
      const msg = findByClass(list, "msg") as FakeEl;
      const [first, second] = msg.children as FakeEl[];
      expect(first?.attrs.get("class")).toBe("deck");
      expect(first?.attrs.get("style")).toBe("--n:2");
      expect(first?.attrs.get("data-gallery")).toBe("Your message");
      const cards = (first as FakeEl).querySelectorAll(".deck-card");
      expect(cards.map((c) => c.attrs.get("data-view"))).toEqual(["blb_a", "blb_b"]);
      expect(cards.map((c) => c.attrs.get("style"))).toEqual(["--i:0", "--i:1"]);
      expect(second?.attrs.get("class")).toBe("bubble");
      expect(findByClass(second as FakeEl, "figures")).toBeUndefined();
    });
  });

  test("a user message of only images is a deck with no empty bubble", () => {
    withFakeDom(() => {
      const list = render("user", [filePartOf("p1", "blb_a", "a.png")]);
      const msg = findByClass(list, "msg") as FakeEl;
      expect(findByClass(msg, "deck")?.attrs.get("class")).toBe("deck single");
      expect(findByClass(msg, "bubble")).toBeUndefined();
    });
  });

  test("presented images become framed figures, a consecutive run sharing one grid", () => {
    withFakeDom(() => {
      const list = render("assistant", [
        textPartOf("p1", "Before and after:"),
        filePartOf("p2", "blb_a", "before.png"),
        filePartOf("p3", "blb_b", "after.png"),
        textPartOf("p4", "Done."),
        filePartOf("p5", "blb_c", "extra.png"),
      ]);
      expect(findByClass(list, "deck")).toBeUndefined();
      const groups = list.querySelectorAll(".figures");
      expect(groups.map((g) => g.attrs.get("class"))).toEqual(["figures grid", "figures"]);
      expect((groups[0] as FakeEl).querySelectorAll(".fig-pic").map((p) => p.attrs.get("data-view"))).toEqual(
        ["blb_a", "blb_b"],
      );
    });
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession: (id) => opened.push(id),
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      fn(root, chat, opened);
    } finally {
      g.document = saved;
    }
  };
  const kid = (id: string, title: string, createdAt: number, stage = 1) => ({
    ...session,
    id,
    title,
    parentSessionId: "ses_p",
    createdAt,
    settings: { agent: { parentRunId: "run_1", stage } },
  });
  const child = kid("ses_c1", "Audit queue", 2_000);
  const text = (n: FakeEl | undefined): string =>
    n === undefined
      ? ""
      : n.children.map((c) => (c instanceof FakeEl ? text(c) : String(c))).join("") + n.textContent;
  const inRun = (...parts: Part[]): SessionView => ({
    ...viewWith(parts),
    messages: [{ message: { ...message, runId: "run_1" }, parts }],
  });
  const tasks = (...t: Record<string, unknown>[]) => ({ tasks: t });
  const cls = (n: FakeEl | undefined): string => n?.attrs.get("class") ?? "";

  test("parallel subagents are one card with a row each, not tool rows", () => {
    withDom((root, chat) => {
      const part = toolPart({
        name: "subagent",
        status: "running",
        input: tasks({ prompt: "a" }, { prompt: "b" }),
      });
      const subs = [
        { session: child, indicator: "done" as const },
        { session: kid("ses_c2", "Check tests", 2_001), indicator: "running" as const },
      ];
      chat.update(inRun(part), [], undefined, undefined, { subs });
      expect(findByClass(root, "part-row")).toBeUndefined();
      const cards = (findByClass(root, "messages") as FakeEl).querySelectorAll(".sub-card");
      expect(cards).toHaveLength(1);
      const card = cards[0] as FakeEl;
      expect(text(findByClass(card, "sub-tag"))).toBe("2 subagents · 1/2 done");
      const rows = card.querySelectorAll(".sub-row");
      expect(rows.map((r) => text(findByClass(r, "sub-title")))).toEqual(["Audit queue", "Check tests"]);
      expect(rows.map((r) => text(findByClass(r, "sub-state")))).toEqual(["done", "working"]);
      expect(rows.map((r) => r.attrs.get("data-open-session"))).toEqual(["ses_c1", "ses_c2"]);
      expect(cls(findByClass(card, "dot"))).toBe("dot running");
    });
  });

  test("a staged call labels its stages and shows a later stage as queued until it starts", () => {
    withDom((root, chat) => {
      const part = toolPart({
        name: "subagent",
        status: "running",
        input: tasks({ prompt: "build", stage: 1 }, { prompt: "test", stage: 2 }),
      });
      chat.update(inRun(part), [], undefined, undefined, {
        subs: [{ session: kid("ses_c1", "Build it", 2_000), indicator: "running" }],
      });
      const card = findByClass(root, "sub-card") as FakeEl;
      expect(card.querySelectorAll(".sub-stage").map((n) => text(n))).toEqual(["Stage 1", "Stage 2"]);
      const [first, second] = card.querySelectorAll(".sub-row") as [FakeEl, FakeEl];
      expect(first.tag).toBe("button");
      expect(second.tag).toBe("div");
      expect(text(findByClass(second, "sub-state"))).toBe("queued");
      expect(second.attrs.has("data-open-session")).toBe(false);
    });
  });

  test("a single subagent is a card with one row, tagged singular, that follows its child", () => {
    withDom((root, chat) => {
      const part = toolPart({ name: "subagent", input: tasks({ prompt: "x" }), output: "ok" });
      const show = (indicator: "running" | "done") =>
        chat.update(inRun(part), [], undefined, undefined, { subs: [{ session: child, indicator }] });
      show("running");
      const card = findByClass(root, "sub-card") as FakeEl;
      expect(text(findByClass(card, "sub-tag"))).toBe("Subagent");
      expect(cls(findByClass(card, "dot"))).toBe("dot running");
      show("done");
      expect(cls(findByClass(card, "dot"))).toBe("dot done");
    });
  });

  test("a call whose child is gone is a card whose row cannot be opened", () => {
    withDom((root, chat) => {
      chat.update(inRun(toolPart({ name: "subagent", input: tasks({ prompt: "x" }) })), []);
      expect(findByClass(root, "sub-card")).toBeDefined();
      expect(findByClass(root, "sub-row")?.tag).toBe("div");
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

describe("session actions", () => {
  const withActions = (
    fn: (root: FakeEl, chat: ReturnType<typeof createChat>, forks: (string | undefined)[]) => void,
  ): void => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.document;
    g.document = { createElement: (tag: string) => new FakeEl(tag), createTextNode: (text: string) => text };
    try {
      const root = new FakeEl("div");
      const forks: (string | undefined)[] = [];
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onFork: (id) => forks.push(id),
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      fn(root, chat, forks);
    } finally {
      g.document = saved;
    }
  };
  const textPart = (): Part => ({
    id: "prt_t",
    messageId: "msg_1",
    idx: 0,
    status: "complete",
    type: "text",
    data: { type: "text", text: "hello" },
    createdAt: 1,
    updatedAt: 1,
  });

  test("a finished message has a fork button carrying its id, and clicking it forks from there", () => {
    withActions((root, chat, forks) => {
      chat.update(viewWith([textPart()]), []);
      const btn = findByClass(root, "fork-btn") as FakeEl;
      expect(btn.dataset.forkId).toBe("msg_1");
      const target = { closest: (sel: string) => (sel === ".fork-btn" ? btn : null) };
      findByClass(root, "messages")?.dispatch("click", { target });
      expect(forks).toEqual(["msg_1"]);
    });
  });

  test("a message still streaming has no fork button", () => {
    withActions((root, chat) => {
      const view = viewWith([textPart()]);
      (view.messages[0] as ChatMessage).message = { ...message, status: "streaming" };
      chat.update(view, []);
      expect(findByClass(root, "fork-btn")).toBeUndefined();
    });
  });

  test("a fork's header links back to its source and hides the link when there is none", () => {
    withActions((root, chat) => {
      const source = { ...session, id: "ses_src", title: "Original" };
      chat.update(viewWith([]), [], undefined, undefined, { forkedFrom: source, subs: [] });
      const crumbs = root.querySelectorAll("crumb");
      const forkCrumb = crumbs[1] as FakeEl;
      expect(forkCrumb.style.display).toBe("");
      expect(findByClass(forkCrumb, "crumb-text")?.textContent).toBe("Forked from Original");
      chat.update(viewWith([]), [], undefined, undefined, { subs: [] });
      expect(forkCrumb.style.display).toBe("none");
    });
  });

  test("the queued count shows beside the stop button only while messages wait", () => {
    withActions((root, chat) => {
      const view = viewWith([]);
      view.queued = 2;
      chat.update(view, []);
      const badge = findByClass(root, "queued-badge") as FakeEl;
      expect(badge.style.display).toBe("");
      expect(badge.textContent).toBe("2 queued");
      view.queued = 0;
      chat.update(view, []);
      expect(badge.style.display).toBe("none");
    });
  });
});

describe("custom parts", () => {
  const withDom = (fn: (root: FakeEl, chat: ReturnType<typeof createChat>) => void): void => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.document;
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
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      fn(root, chat);
    } finally {
      g.document = saved;
    }
  };
  const text = (n: FakeEl | undefined): string =>
    n === undefined
      ? ""
      : n.textContent + n.children.map((c) => (c instanceof FakeEl ? text(c) : String(c))).join("");
  const jobData = {
    jobId: "j1",
    status: "done",
    exitCode: 0,
    killReason: null,
    label: "build",
    durationMs: 30_000,
  };
  const custom = (over: Partial<Extract<PartData, { type: "custom" }>> = {}): Part => ({
    ...toolPart(),
    id: "prt_c",
    type: "custom",
    data: {
      type: "custom",
      kind: "valet-exec/job-end@1",
      title: "Process finished: build (exit 0, 30s)",
      text: "Background job j1 (build) exited 0 after 30s.",
      data: jobData,
      ...over,
    },
  });
  const systemView = (...parts: Part[]): SessionView => ({
    ...viewWith(parts),
    messages: [{ message: { ...message, role: "system" }, parts }],
  });
  const jobEnd: PartType = {
    id: "valet-exec/job-end@1",
    view: { fields: ["label", "exitCode"], level: "warn" },
    plugin: { id: "valet-exec", version: "0.1.0", repository: "https://github.com/valethq/valet-exec" },
    loaded: false,
  };

  test("a system message of only custom parts is a bare collapsed row titled by the part", () => {
    withDom((root, chat) => {
      chat.update(systemView(custom()), []);
      const msg = findByClass(root, "msg") as FakeEl;
      expect(msg.attrs.get("class")).toBe("msg system bare fade");
      const row = findByClass(msg, "part-row") as FakeEl;
      expect((row as unknown as { open: boolean }).open).toBe(false);
      expect(text(findTag(row, "summary"))).toBe("Process finished: build (exit 0, 30s)");
      const body = findByClass(row, "body") as FakeEl;
      expect(text(findTag(body, "pre"))).toBe("Background job j1 (build) exited 0 after 30s.");
      expect(text(findByClass(body, "part-origin"))).toBe("valet-exec/job-end@1");
      expect(findTag(body, "dl")).toBeUndefined();
    });
  });

  test("the registry adds fields, origin, level and the raw data behind a second row", () => {
    withDom((root, chat) => {
      chat.update(systemView(custom()), []);
      chat.setPartTypes([jobEnd]);
      const row = findByClass(root, "part-row") as FakeEl;
      expect(row.attrs.get("class")).toBe("part-row warn");
      const body = findByClass(row, "body") as FakeEl;
      const dl = findTag(body, "dl") as FakeEl;
      expect(dl.children.map((c) => text(c as FakeEl))).toEqual(["label", "build", "exitCode", "0"]);
      const origin = findByClass(body, "part-origin") as FakeEl;
      expect(text(origin)).toBe("valet-exec/job-end@1 · valet-exec 0.1.0 · not loaded");
      expect(findTag(origin, "a")?.attrs.get("href")).toBe("https://github.com/valethq/valet-exec");
      const raw = findByClass(body, "part-row") as FakeEl;
      expect((raw as unknown as { open: boolean }).open).toBe(false);
      expect(text(findTag(raw, "summary"))).toBe("Raw data");
      expect(JSON.parse(text(findTag(findByClass(raw, "body") as FakeEl, "pre")))).toEqual(jobData);
    });
  });

  test("view.collapsed false opens the row, and a mixed system message keeps its chrome", () => {
    withDom((root, chat) => {
      chat.setPartTypes([{ ...jobEnd, view: { collapsed: false } }]);
      const note = {
        ...toolPart(),
        id: "prt_n",
        type: "notice",
        data: { type: "notice", level: "error", text: "hook failed" },
      } as Part;
      chat.update(systemView(custom(), note), []);
      expect(findByClass(root, "msg")?.attrs.get("class")).toBe("msg system fade");
      const row = findByClass(root, "part-row") as FakeEl;
      expect((row as unknown as { open: boolean }).open).toBe(true);
      expect(row.attrs.get("class")).toBe("part-row");
    });
  });
});

describe("galleryItems", () => {
  test("lists each image once, in order, with the node it opened from", () => {
    const node = (view: string, name: string) => ({ dataset: { view, name, mime: "image/png" } });
    const nodes = [node("blb_a", "a.png"), node("blb_b", "b.png"), node("blb_a", "a.png")];
    const items = galleryItems({ querySelectorAll: () => nodes } as unknown as Element);
    expect(items.map((i) => i.file.blobId)).toEqual(["blb_a", "blb_b"]);
    expect(items[1]?.thumb).toBe(nodes[1] as unknown as HTMLElement);
  });
});

describe("model chip logos", () => {
  const providers: ProviderModels[] = [
    {
      provider: "cursor",
      label: "Cursor",
      icon: "cursor",
      models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", efforts: ["high"] }],
    },
    {
      provider: "claude-code",
      label: "Claude Code",
      icon: "claude",
      models: [{ id: "opus", name: "Claude Opus 5.5", efforts: ["high"] }],
    },
  ];
  const logos = (n: FakeEl): string[] => [
    ...(n.attrs.has("data-logo") ? [n.attrs.get("data-logo") as string] : []),
    ...n.children.flatMap((c) => (c instanceof FakeEl ? logos(c) : [])),
  ];
  const chipFor = (provider: string, model: string) => {
    const g = globalThis as Record<string, unknown>;
    const savedDocument = g.document;
    const savedWindow = g.window;
    // Just enough DOM for the model popover to open and fill its rows.
    const createElement = (tag: string) =>
      Object.assign(new FakeEl(tag), { focus() {}, scrollIntoView() {} }, { style: { removeProperty() {} } });
    g.document = { createElement, addEventListener() {}, removeEventListener() {} };
    g.window = { innerWidth: 1000 };
    try {
      const root = new FakeEl("div");
      const chat = createChat(root as unknown as HTMLElement, {
        onSend: () => Promise.resolve(true),
        onUpload: () => Promise.resolve("blb_1"),
        onStop() {},
        onModel() {},
        onRename() {},
        onDelete() {},
        onFork() {},
        onMove() {},
        onCompact() {},
        onToggleNav() {},
        onOpenSession() {},
        onLoadOlder() {},
        onOpenFile: async () => true,
      });
      const view = viewWith([]);
      chat.update({ ...view, session: { ...session, settings: { model: { provider, model } } } }, providers);
      const chip = findByClass(root, "model") as FakeEl;
      const lead = findByClass(chip, "lead") as FakeEl;
      const sub = findByClass(chip, "chip-sub") as FakeEl;
      const pair = findByClass(lead, "logo-pair");
      const cutoutUrl = pair?.attrs.get("style")?.replace("--model-logo: ", "");
      const shown = {
        cutout: pair?.children.find(
          (c) => c instanceof FakeEl && c.attrs.get("style") === `--logo: ${cutoutUrl}`,
        ) as FakeEl | undefined,
        logos: logos(lead),
        pair: findByClass(lead, "logo-pair") !== undefined,
        harness: findByClass(lead, "harness")?.attrs.get("data-logo"),
        name: findByClass(chip, "chip-label")?.textContent,
        sub: sub.style.display === "none" ? undefined : sub.textContent,
      };
      (findTag(chip, "button") as FakeEl).dispatch("click", {});
      const rows = (findByClass(root, "menu") as FakeEl).querySelectorAll(".menu-lead").map(logos);
      return { ...shown, cutout: shown.cutout?.attrs.get("data-logo"), rows };
    } finally {
      g.document = savedDocument;
      g.window = savedWindow;
    }
  };

  test("a harness running another lab's model puts its mark first, under the model's, with an 'on' line", () => {
    expect(chipFor("cursor", "claude-sonnet-5")).toMatchObject({
      logos: ["cursor", "claude"],
      pair: true,
      harness: "cursor",
      cutout: "claude",
      name: "Claude Sonnet 5",
      sub: "on Cursor",
    });
  });

  test("a harness whose logo matches the model shows the model mark and name alone", () => {
    expect(chipFor("claude-code", "opus")).toMatchObject({
      logos: ["claude"],
      pair: false,
      harness: undefined,
      cutout: undefined,
      name: "Claude Opus 5.5",
      sub: undefined,
    });
  });

  test("picker rows show only the model's own logo, never the harness's", () => {
    expect(chipFor("cursor", "claude-sonnet-5").rows).toEqual([["claude"], ["claude"]]);
  });
});

describe("composer drafts", () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const withDom = (run: () => Promise<void>): (() => Promise<void>) => {
    return async () => {
      const g = globalThis as Record<string, unknown>;
      const saved = { document: g.document, localStorage: g.localStorage };
      const store = new Map<string, string>();
      g.document = { createElement: (tag: string) => new FakeEl(tag) };
      g.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      };
      try {
        await run();
      } finally {
        g.document = saved.document;
        g.localStorage = saved.localStorage;
      }
    };
  };
  const make = (onSend: (parts: unknown) => Promise<boolean> = () => Promise.resolve(true)) => {
    const root = new FakeEl("div");
    const chat = createChat(root as unknown as HTMLElement, {
      onSend,
      onUpload: () => Promise.resolve("blb_1"),
      onStop() {},
      onModel() {},
      onRename() {},
      onDelete() {},
      onFork() {},
      onMove() {},
      onCompact() {},
      onToggleNav() {},
      onOpenSession() {},
      onLoadOlder() {},
      onOpenFile: async () => true,
    });
    const textarea = findTag(root, "textarea") as FakeEl;
    const type = (text: string) => {
      textarea.value = text;
      textarea.dispatch("input", {});
    };
    return { root, chat, textarea, type };
  };
  const other = { ...viewWith([]), session: { ...session, id: "ses_other" } };

  test(
    "each session keeps what was typed in it across switches and a fresh composer",
    withDom(async () => {
      const { chat, textarea, type } = make();
      chat.update(viewWith([]), []);
      type("half a thought");
      chat.update(other, []);
      expect(textarea.value).toBe("");
      type("something else");
      chat.update(viewWith([]), []);
      expect(textarea.value).toBe("half a thought");

      const reloaded = make();
      reloaded.chat.update(other, []);
      expect(reloaded.textarea.value).toBe("something else");
    }),
  );

  test(
    "sending clears the session's draft, even after switching away mid-send",
    withDom(async () => {
      let finish: (ok: boolean) => void = () => {};
      const { root, chat, textarea, type } = make(() => new Promise((r) => (finish = r)));
      chat.update(viewWith([]), []);
      type("ship it");
      (findByClass(root, "send") as FakeEl).dispatch("click", {});
      await tick();
      chat.update(other, []);
      finish(true);
      await tick();
      chat.update(viewWith([]), []);
      expect(textarea.value).toBe("");
    }),
  );

  test(
    "text sent from the new-chat page goes along into the session it creates",
    withDom(async () => {
      const { root, chat, textarea, type } = make(async () => {
        chat.update(viewWith([]), []);
        expect(textarea.value).toBe("first message");
        return false;
      });
      type("first message");
      (findByClass(root, "send") as FakeEl).dispatch("click", {});
      await tick();
      await tick();
      expect(textarea.value).toBe("first message");
      const reloaded = make();
      expect(reloaded.textarea.value).toBe("");
      reloaded.chat.update(viewWith([]), []);
      expect(reloaded.textarea.value).toBe("first message");
    }),
  );
});
