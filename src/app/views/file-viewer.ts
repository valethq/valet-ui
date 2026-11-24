import * as api from "../api";
import { el } from "../dom";
import { baseName, type FileRef, joinPath } from "../file-ref";
import { highlightLines, langFor } from "../highlight";
import { type IconName, icon, iconButton } from "../icons";
import { renderMarkdown } from "../markdown";
import { type ImageStage, imageStage } from "./image-stage";
import { copyImage, copyImageUrl, type FileData, saveBlob, saveUrl } from "./media";

/** A message's images, shown one at a time in a single tab. */
export interface Gallery {
  items: FileData[];
  index: number;
  /** Where they came from, e.g. "Your message". */
  source: string;
}

/** A file to show, resolved against the project of `sessionId`, or one of a chat's images. */
export interface FileTarget extends FileRef {
  sessionId: string;
  gallery?: Gallery;
}

export interface FileViewer {
  /** The panel and its narrow-screen scrim, to mount inside the app root. */
  readonly nodes: HTMLElement[];
  /** Resolves false when the file does not exist. */
  open(target: FileTarget): Promise<boolean>;
  close(): void;
  /** Shows only the tabs opened in this session, and the panel only if it was open there. */
  setSession(sessionId: string | null): void;
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
  /** An image's natural size, once it has loaded. */
  dims?: string;
  stage?: ImageStage;
}

const WIDTH_KEY = "valet-ui.viewer-width";
const WRAP_KEY = "valet-ui.viewer-wrap";
const WIDTH_DEFAULT = 560;
const WIDTH_MIN = 340;

const isMarkdown = (path: string): boolean => langFor(path)?.name === "Markdown";
const keyOf = (t: FileTarget): string =>
  `${t.sessionId}\n${t.gallery === undefined ? t.path : `gallery:${t.gallery.items.map((i) => i.blobId).join(",")}`}`;
const imageAt = (g: Gallery): FileData => g.items[g.index] as FileData;
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
  const lines = highlightLines(file.text ?? "", langFor(file.rel));
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

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [n, unit] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / 1024 / 1024, "MB"];
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unit}`;
}

/** "PNG", "MP4", ... from the file's extension. */
const typeLabel = (rel: string): string => baseName(rel).split(".").pop()?.toUpperCase() ?? "";

/** The file panel: tabs, a highlighted source view (or rendered markdown) with the referenced lines, and media. */
export function createFileViewer(app: HTMLElement, setOpen: (open: boolean) => void): FileViewer {
  const tabs: Tab[] = [];
  let active: Tab | null = null;
  let isOpen = false;
  let session: string | null = null;
  /** Per session: whether the panel was left open, and on which tab. */
  const sessions = new Map<string, { open: boolean; active?: string }>();
  const stateOf = (id: string) => {
    const st = sessions.get(id) ?? { open: false };
    sessions.set(id, st);
    return st;
  };
  const here = (): Tab[] => tabs.filter((t) => t.target.sessionId === session);

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
  const copyImgBtn = iconButton("copy", "Copy image", "fv-copy-img");
  const saveBtn = iconButton("import", "Download", "fv-save");
  const copyBtn = iconButton("link", "Copy path", "fv-copy");
  const zoomOut = iconButton("minus", "Zoom out", "fv-zoom-out");
  const zoomIn = iconButton("plus", "Zoom in", "fv-zoom-in");
  const zoomPct = el("button", { class: "fv-pct", type: "button" });
  const zoom = el("div", { class: "fv-zoom", role: "group", "aria-label": "Zoom" }, zoomOut, zoomPct, zoomIn);
  const prevBtn = iconButton("chevronLeft", "Previous image", "fv-prev");
  const nextBtn = iconButton("chevronRight", "Next image", "fv-next");
  const count = el("span", { class: "fv-count" });
  const nav = el("div", { class: "fv-nav" }, prevBtn, count, nextBtn);
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
    el("div", { class: "fv-head" }, path, meta, seg, nav),
    body,
    el(
      "div",
      { class: "fv-foot" },
      zoom,
      status,
      el("div", { class: "fv-acts" }, wrapBtn, copyImgBtn, saveBtn, copyBtn),
    ),
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
    const gallery = tab.target.gallery;
    const rel = file?.rel ?? tab.target.path;
    const dir =
      gallery !== undefined ? `${gallery.source}/` : rel.slice(0, rel.length - baseName(rel).length);
    path.replaceChildren(
      el("span", {
        class: "fv-dir",
        text: file === undefined || gallery !== undefined ? dir : `${file.root}/${dir}`,
      }),
      el("b", { text: baseName(rel) }),
    );
    path.title = file?.path ?? tab.target.path;
    meta.textContent =
      file === undefined
        ? ""
        : file.kind === "text"
          ? `${lineCount(file.text ?? "")} lines · ${langFor(file.rel)?.name ?? "Plain text"}`
          : [tab.dims, typeLabel(file.rel), gallery === undefined ? sizeLabel(file.size) : ""]
              .filter(Boolean)
              .join(" · ");
    seg.hidden = file === undefined || file.kind !== "text" || !isMarkdown(file.rel);
    nav.hidden = gallery === undefined || gallery.items.length < 2;
    if (gallery !== undefined) {
      count.textContent = `${gallery.index + 1} / ${gallery.items.length}`;
      prevBtn.disabled = gallery.index === 0;
      nextBtn.disabled = gallery.index === gallery.items.length - 1;
    }
    preview.classList.toggle("on", tab.mode === "preview");
    source.classList.toggle("on", tab.mode === "source");
    const { line, end } = tab.target;
    status.textContent =
      file === undefined
        ? (tab.error ?? "Loading…")
        : file.kind !== "text" || tab.mode === "preview" || line === undefined
          ? ""
          : end === undefined
            ? `Line ${line}`
            : `Lines ${line}–${end}`;
    const kind = file?.kind;
    wrapBtn.hidden = kind !== undefined && kind !== "text";
    copyImgBtn.hidden = kind !== "image";
    saveBtn.hidden = kind === undefined || kind === "text";
    copyBtn.hidden = gallery !== undefined;
    copyBtn.disabled = file === undefined;
    renderZoom(tab);
  }

  function renderZoom(tab: Tab): void {
    const st = tab.stage;
    zoom.hidden = st === undefined || tab.file === undefined;
    if (st === undefined) return;
    const pct = Math.round(st.percent() * 100);
    zoomPct.textContent = `${pct}%`;
    zoomPct.title = st.zoomed() ? "Fit to panel (0)" : "Actual size (1)";
    zoomOut.disabled = !st.zoomed();
  }

  /** The image a tab shows: a chat image (blob) or a project file served raw. */
  function imageSource(tab: Tab): {
    src: string | Promise<string>;
    copy(): Promise<void>;
    save(): Promise<void>;
  } {
    const g = tab.target.gallery;
    if (g !== undefined) {
      const it = imageAt(g);
      return {
        src: api.blobUrl(it.blobId),
        copy: () => copyImage(it.blobId),
        save: () => saveBlob(it.blobId, it.name),
      };
    }
    const file = tab.file as api.ProjectFile;
    const url = api.fileUrl(tab.target.sessionId, file.rel);
    return { src: url, copy: () => copyImageUrl(url), save: async () => saveUrl(url, baseName(file.rel)) };
  }

  /** A gallery tab's file record for its current image (blobs have no project path or size). */
  function galleryFile(tab: Tab, g: Gallery): void {
    const it = imageAt(g);
    tab.target = { ...tab.target, path: it.name, gallery: g };
    tab.file = { path: it.name, rel: it.name, root: g.source, size: 0, kind: "image", mime: it.mime };
    tab.dims = undefined;
    tab.error = undefined;
    const name = tab.button.querySelector(".fv-tab-name");
    if (name !== null) name.textContent = it.name;
    tab.button.title = it.name;
  }

  function goTo(tab: Tab, index: number): void {
    const g = tab.target.gallery;
    if (g === undefined || index < 0 || index >= g.items.length || index === g.index) return;
    const dir = index > g.index ? "from-next" : "from-prev";
    galleryFile(tab, { ...g, index });
    show(tab, true);
    tab.stage?.img.classList.add(dir);
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
    tab.stage = undefined;
    if (tab.file.kind !== "text") return mediaView(tab);
    if (tab.mode === "preview") {
      const md = renderMarkdown(tab.file.text ?? "");
      md.className = "bubble";
      return el("div", { class: "fv-md msg assistant" }, md);
    }
    return sourceView(tab.file);
  }

  /** An image that zooms and pans, or a player for audio and video. */
  function mediaView(tab: Tab): HTMLElement {
    const file = tab.file as api.ProjectFile;
    const failed = (): void => {
      tab.error = "The file couldn't be loaded";
      tab.file = undefined;
      show(tab, true);
    };
    if (file.kind === "image") {
      const st = imageStage(imageSource(tab).src, baseName(file.rel));
      tab.stage = st;
      st.onChange = () => {
        if (tab.dims === undefined && st.img.naturalWidth > 0) {
          tab.dims = `${st.img.naturalWidth} × ${st.img.naturalHeight}`;
          if (active === tab) renderHead(tab);
        }
        if (active === tab) renderZoom(tab);
      };
      st.onSwipe = (dir) => goTo(tab, (tab.target.gallery?.index ?? 0) + dir);
      st.onError = failed;
      return st.node;
    }
    const src = api.fileUrl(tab.target.sessionId, file.rel);
    const kind = file.kind === "audio" ? "audio" : "video";
    const player = el(kind, { class: `fv-${kind}`, src, controls: "", preload: "metadata" });
    player.addEventListener("error", failed);
    return el("div", { class: `fv-media ${file.kind}` }, player);
  }

  /** Marks the target lines and scrolls the first into the upper third. */
  function markLines(tab: Tab): void {
    const view = tab.body;
    if (view === undefined || tab.mode !== "source" || tab.file?.kind !== "text") return;
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
    stateOf(tab.target.sessionId).active = tab.key;
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
    if (!settle || tab.target.sessionId !== session) return;
    const left = here();
    if (left.length === 0) {
      active = null;
      close();
    } else if (active === tab) show(left.find((t) => tabs.indexOf(t) >= at) ?? (left.at(-1) as Tab));
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

  function hide(): void {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    setOpen(false);
  }

  function close(): void {
    if (session !== null) stateOf(session).open = false;
    hide();
  }

  function setSession(id: string | null): void {
    if (id === session) return;
    session = id;
    for (const t of tabs) t.button.hidden = t.target.sessionId !== id;
    const st = id === null ? undefined : sessions.get(id);
    const mine = here();
    const tab = mine.find((t) => t.key === st?.active) ?? mine[0];
    if (st?.open !== true || tab === undefined) {
      active = null;
      hide();
      return;
    }
    reveal();
    // Chat images are object URLs, freed when their chat is left; rebuild so they are fetched again.
    show(tab, tab.target.gallery !== undefined);
  }

  async function open(target: FileTarget): Promise<boolean> {
    setSession(target.sessionId);
    stateOf(target.sessionId).open = true;
    reveal();
    if (target.gallery !== undefined) {
      const tab = tabs.find((t) => t.key === keyOf(target)) ?? addTab(target);
      galleryFile(tab, target.gallery);
      show(tab, true);
      panel.focus({ preventScroll: true });
      return true;
    }
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
      const same = tabs.find(
        (t) => t !== tab && t.target.sessionId === target.sessionId && t.file?.path === file.path,
      );
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
  const flash = (btn: HTMLButtonElement, name: IconName, ok: boolean): void => {
    btn.replaceChildren(icon(ok ? "check" : "close"));
    setTimeout(() => btn.replaceChildren(icon(name)), 1500);
  };
  copyImgBtn.addEventListener("click", () => {
    if (active === null) return;
    imageSource(active)
      .copy()
      .then(
        () => flash(copyImgBtn, "copy", true),
        () => flash(copyImgBtn, "copy", false),
      );
  });
  saveBtn.addEventListener("click", () => {
    if (active === null) return;
    const file = active.file;
    if (file?.kind === "image")
      imageSource(active)
        .save()
        .catch(() => flash(saveBtn, "import", false));
    else if (file !== undefined) saveUrl(api.fileUrl(active.target.sessionId, file.rel), baseName(file.rel));
  });
  zoomIn.addEventListener("click", () => active?.stage?.step(1));
  zoomOut.addEventListener("click", () => active?.stage?.step(-1));
  zoomPct.addEventListener("click", () => {
    const st = active?.stage;
    if (st === undefined) return;
    if (st.zoomed()) st.fit();
    else st.toggleActual();
  });
  prevBtn.addEventListener(
    "click",
    () => active !== null && goTo(active, (active.target.gallery?.index ?? 0) - 1),
  );
  nextBtn.addEventListener(
    "click",
    () => active !== null && goTo(active, (active.target.gallery?.index ?? 0) + 1),
  );
  // With focus in the panel: zoom and pan keys for an image, arrows step through a message's images.
  panel.addEventListener("keydown", (ev) => {
    const tab = active;
    if (tab === null || ev.defaultPrevented) return;
    if ((ev.target as Element).closest("input, textarea, select, button, [role=separator]") !== null) return;
    if (tab.stage?.key(ev)) return;
    const g = tab.target.gallery;
    if (g === undefined || (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight")) return;
    ev.preventDefault();
    goTo(tab, g.index + (ev.key === "ArrowRight" ? 1 : -1));
  });
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
    navigator.clipboard.writeText(file.path).then(
      () => flash(copyBtn, "link", true),
      () => flash(copyBtn, "link", false),
    );
  });
  // Escape fits a zoomed image, else closes the panel, unless a menu, modal or text field has it.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented || !isOpen) return;
    const t = ev.target as Element | null;
    if (t?.closest("input, textarea, select, [contenteditable], .menu, .modal") != null) return;
    if (document.querySelector(".modal-backdrop") !== null) return;
    ev.preventDefault();
    if (active?.stage?.zoomed()) active.stage.fit();
    else close();
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
  return { nodes: [scrim, panel], open, close, setSession };
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
