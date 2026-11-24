import * as api from "../api";
import { el } from "../dom";
import { baseName, type FileRef, joinPath } from "../file-ref";
import { highlightLines, langFor } from "../highlight";
import { icon, iconButton } from "../icons";
import { renderMarkdown } from "../markdown";

/** A file to show, resolved against the project of `sessionId`. */
export interface FileTarget extends FileRef {
  sessionId: string;
}

export interface FileViewer {
  /** The panel and its narrow-screen scrim, to mount inside the app root. */
  readonly nodes: HTMLElement[];
  /** Resolves false when the file does not exist. */
  open(target: FileTarget): Promise<boolean>;
  close(): void;
}

interface Tab {
  key: string;
  target: FileTarget;
  button: HTMLButtonElement;
  file?: api.ProjectFile;
  error?: string;
  missing?: boolean;
  body?: HTMLElement;
  mode: "source" | "preview";
}

const WIDTH_KEY = "valet-ui.viewer-width";
const WRAP_KEY = "valet-ui.viewer-wrap";
const WIDTH_DEFAULT = 560;
const WIDTH_MIN = 340;

const isMarkdown = (path: string): boolean => langFor(path)?.name === "Markdown";
const keyOf = (t: FileTarget): string => `${t.sessionId}\n${t.path}`;
const dirOf = (rel: string): string => rel.split("/").slice(0, -1).join("/");

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode; lasts until reload
  }
}

/** The file as numbered, coloured lines. */
function sourceView(file: api.ProjectFile): HTMLElement {
  const code = el("div", { class: "fv-code" });
  const lines = highlightLines(file.text, langFor(file.rel));
  lines.forEach((tokens, i) => {
    const text = el("span", { class: "fv-t" });
    for (const tok of tokens) {
      if (tok.kind === "") text.append(tok.text);
      else text.append(el("span", { class: `tk-${tok.kind}`, text: tok.text }));
    }
    code.append(
      el(
        "div",
        { class: "fv-l", "data-n": String(i + 1) },
        el("span", { class: "fv-n", text: String(i + 1) }),
        text,
      ),
    );
  });
  return code;
}

const lineCount = (text: string): number => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

/** The read-only file panel: tabs, a highlighted source view (or rendered markdown) and the referenced lines. */
export function createFileViewer(app: HTMLElement, setOpen: (open: boolean) => void): FileViewer {
  const tabs: Tab[] = [];
  let active: Tab | null = null;
  let isOpen = false;

  const tablist = el("div", { class: "fv-tablist", role: "tablist" });
  const closeBtn = iconButton("close", "Close file viewer", "fv-close");
  const path = el("div", { class: "fv-path" });
  const meta = el("span", { class: "fv-meta" });
  const preview = el("button", { class: "fv-seg-btn", type: "button", text: "Preview" });
  const source = el("button", { class: "fv-seg-btn", type: "button", text: "Source" });
  const seg = el("div", { class: "fv-seg", role: "group", "aria-label": "View" }, preview, source);
  const body = el("div", { class: "fv-body" });
  const status = el("span", { class: "fv-status" });
  const wrapBtn = iconButton("wrap", "Wrap lines", "fv-wrap");
  const copyBtn = iconButton("copy", "Copy path", "fv-copy");
  const resizer = el("div", {
    class: "fv-resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize file viewer",
    tabindex: "0",
    title: "Drag to resize · double-click to reset",
  });
  const panel = el(
    "aside",
    { class: "file-viewer", tabindex: "-1", "aria-label": "File viewer", hidden: "" },
    resizer,
    el("div", { class: "fv-tabs" }, tablist, closeBtn),
    el("div", { class: "fv-head" }, path, meta, seg),
    body,
    el("div", { class: "fv-foot" }, status, el("div", { class: "fv-acts" }, wrapBtn, copyBtn)),
  );
  const scrim = el("div", { class: "fv-scrim" });

  let wrap = stored(WRAP_KEY) === "1";
  const applyWrap = (): void => {
    panel.classList.toggle("wrap", wrap);
    wrapBtn.classList.toggle("on", wrap);
    wrapBtn.setAttribute("aria-pressed", String(wrap));
  };
  applyWrap();

  function renderHead(tab: Tab): void {
    const file = tab.file;
    const rel = file?.rel ?? tab.target.path;
    const dir = rel.slice(0, rel.length - baseName(rel).length);
    path.replaceChildren(
      el("span", { class: "fv-dir", text: file === undefined ? "" : `${file.root}/${dir}` }),
      el("b", { text: baseName(rel) }),
    );
    path.title = file?.path ?? tab.target.path;
    meta.textContent =
      file === undefined ? "" : `${lineCount(file.text)} lines · ${langFor(file.rel)?.name ?? "Plain text"}`;
    seg.hidden = file === undefined || !isMarkdown(file.rel);
    preview.classList.toggle("on", tab.mode === "preview");
    source.classList.toggle("on", tab.mode === "source");
    const { line, end } = tab.target;
    status.textContent =
      file === undefined
        ? (tab.error ?? "Loading…")
        : tab.mode === "preview" || line === undefined
          ? "Read-only"
          : end === undefined
            ? `Line ${line} · read-only`
            : `Lines ${line}–${end} · read-only`;
    copyBtn.disabled = file === undefined;
  }

  function buildBody(tab: Tab): HTMLElement {
    if (tab.file === undefined) {
      return el(
        "div",
        { class: "fv-empty" },
        tab.error === undefined
          ? el("span", { class: "fv-loading", text: "Loading…" })
          : el("div", {}, el("b", { text: "Can't open this file" }), el("span", { text: tab.error })),
      );
    }
    if (tab.mode === "preview") {
      const md = renderMarkdown(tab.file.text);
      md.className = "bubble";
      return el("div", { class: "fv-md msg assistant" }, md);
    }
    return sourceView(tab.file);
  }

  /** Marks the target lines and scrolls the first into the upper third. */
  function markLines(tab: Tab): void {
    const view = tab.body;
    if (view === undefined || tab.mode !== "source") return;
    for (const hl of view.querySelectorAll(".fv-l.hl")) hl.classList.remove("hl");
    const { line, end } = tab.target;
    if (line === undefined) return;
    const rows = view.children;
    for (let n = line; n <= (end ?? line) && n <= rows.length; n++) rows[n - 1]?.classList.add("hl");
    const first = rows[line - 1] as HTMLElement | undefined;
    if (first !== undefined)
      requestAnimationFrame(() => (body.scrollTop = Math.max(0, first.offsetTop - body.clientHeight / 3)));
  }

  function show(tab: Tab, fresh = false): void {
    active = tab;
    for (const t of tabs) {
      t.button.classList.toggle("on", t === tab);
      t.button.setAttribute("aria-selected", String(t === tab));
    }
    renderHead(tab);
    if (tab.body === undefined || fresh) tab.body = buildBody(tab);
    body.replaceChildren(tab.body);
    body.scrollTop = 0;
    markLines(tab);
    tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** `settle` picks the next tab (or closes the panel when none is left). */
  function removeTab(tab: Tab, settle = true): void {
    const at = tabs.indexOf(tab);
    if (at < 0) return;
    tabs.splice(at, 1);
    tab.button.remove();
    if (!settle) return;
    if (tabs.length === 0) {
      active = null;
      close();
    } else if (active === tab) show(tabs[Math.min(at, tabs.length - 1)] as Tab);
  }

  function addTab(target: FileTarget): Tab {
    const x = el(
      "span",
      { class: "fv-tab-x", role: "button", "aria-label": "Close tab", title: "Close tab" },
      icon("close"),
    );
    const button = el(
      "button",
      { class: "fv-tab", type: "button", role: "tab", title: target.path },
      el("span", { class: "fv-tab-name", text: baseName(target.path) }),
      x,
    );
    const tab: Tab = {
      key: keyOf(target),
      target,
      button,
      mode: isMarkdown(target.path) && target.line === undefined ? "preview" : "source",
    };
    button.addEventListener("click", (ev) => {
      if ((ev.target as Element).closest(".fv-tab-x") !== null) removeTab(tab);
      else show(tab);
    });
    button.addEventListener("auxclick", (ev) => {
      if (ev.button === 1) removeTab(tab);
    });
    tabs.push(tab);
    tablist.append(button);
    return tab;
  }

  function reveal(): void {
    if (isOpen) return;
    isOpen = true;
    panel.hidden = false;
    setOpen(true);
    panel.focus({ preventScroll: true });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    setOpen(false);
  }

  async function open(target: FileTarget): Promise<boolean> {
    reveal();
    const stale = tabs.find((t) => t.key === keyOf(target) && t.error !== undefined);
    if (stale !== undefined) removeTab(stale, false);
    const existing = tabs.find((t) => t.key === keyOf(target));
    if (existing !== undefined) {
      existing.target = target;
      if (target.line !== undefined && existing.mode === "preview") {
        existing.mode = "source";
        existing.body = undefined;
      }
      show(existing);
      return true;
    }
    const tab = addTab(target);
    show(tab);
    try {
      const file = await api.readFile(target.sessionId, target.path);
      const same = tabs.find((t) => t !== tab && t.file?.path === file.path);
      if (same !== undefined) {
        removeTab(tab);
        same.target = { ...target, path: same.target.path };
        show(same);
        return true;
      }
      tab.file = file;
      tab.button.title = file.path;
    } catch (e) {
      tab.error = e instanceof Error ? e.message : "Couldn't read this file";
      tab.missing = e instanceof api.ApiError && e.status === 404;
    }
    if (tabs.includes(tab)) {
      tab.body = undefined;
      if (active === tab) show(tab);
    }
    return tab.missing !== true;
  }

  const setMode = (mode: Tab["mode"]): void => {
    if (active === null || active.mode === mode) return;
    active.mode = mode;
    show(active, true);
  };
  preview.addEventListener("click", () => setMode("preview"));
  source.addEventListener("click", () => setMode("source"));
  closeBtn.addEventListener("click", close);
  scrim.addEventListener("click", close);
  wrapBtn.addEventListener("click", () => {
    wrap = !wrap;
    store(WRAP_KEY, wrap ? "1" : "0");
    applyWrap();
  });
  copyBtn.addEventListener("click", () => {
    const file = active?.file;
    if (file === undefined) return;
    const flash = (name: "check" | "close"): void => {
      copyBtn.replaceChildren(icon(name));
      setTimeout(() => copyBtn.replaceChildren(icon("copy")), 1500);
    };
    navigator.clipboard.writeText(file.path).then(
      () => flash("check"),
      () => flash("close"),
    );
  });
  // Escape closes the panel unless something above it (a menu, modal or lightbox) or a text field has it.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented || !isOpen) return;
    const t = ev.target as Element | null;
    if (t?.closest("input, textarea, select, [contenteditable], .menu, .modal, .lightbox") != null) return;
    if (document.querySelector(".modal-backdrop, .lightbox") !== null) return;
    ev.preventDefault();
    close();
  });
  // Links inside a rendered markdown file resolve against that file's folder.
  const openLink = (ev: Event): void => {
    const chip = (ev.target as Element).closest<HTMLElement>(".fv-md .file-link");
    const file = active?.file;
    if (chip === null || file === undefined || active === null) return;
    ev.preventDefault();
    const line = Number(chip.dataset.line) || undefined;
    const end = Number(chip.dataset.end) || undefined;
    void open({
      sessionId: active.target.sessionId,
      path: joinPath(dirOf(file.rel), chip.dataset.path ?? ""),
      ...(line === undefined ? {} : { line }),
      ...(end === undefined ? {} : { end }),
    });
  };
  body.addEventListener("click", openLink);
  body.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") openLink(ev);
  });

  bindResize(resizer, app);
  return { nodes: [scrim, panel], open, close };
}

/** `--fv-w` on the app root sizes the panel and the chat's right margin. */
function bindResize(handle: HTMLElement, app: HTMLElement): void {
  const max = (): number => Math.max(WIDTH_MIN, Math.min(1100, window.innerWidth - 520));
  let width = WIDTH_DEFAULT;
  const apply = (w: number): void => {
    width = Math.round(Math.min(max(), Math.max(WIDTH_MIN, w)));
    app.style.setProperty("--fv-w", `${width}px`);
  };
  apply(Number(stored(WIDTH_KEY)) || WIDTH_DEFAULT);
  const save = (): void => store(WIDTH_KEY, String(width));
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    app.classList.add("resizing");
    const move = (ev: PointerEvent): void => apply(window.innerWidth - ev.clientX - 10);
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      app.classList.remove("resizing");
      save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => {
    apply(WIDTH_DEFAULT);
    save();
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (step === 0) return;
    e.preventDefault();
    apply(width + step);
    save();
  });
}
