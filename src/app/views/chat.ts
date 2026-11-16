import { clear, el, morph, reconcile } from "../dom";
import { chipButton, icon, iconButton } from "../icons";
import { logoFor, logoMark } from "../logos";
import { type MenuSection, popover } from "../menu";
import { renderMarkdown } from "../markdown";
import { familyOf, groupModels, type ModelFamily, type ModelVariant } from "../models";
import { queueModeOf, type SessionView } from "../state";
import {
  bindSubs,
  isSubagentCall,
  rowState,
  type SessionLinks,
  type SubInfo,
  type SubRow,
  type ToolData,
} from "../subagents";
import type {
  ChatMessage,
  Part,
  PartData,
  PartInput,
  PartType,
  Project,
  ProviderModels,
  QueueMode,
} from "../types";
import { createAttachments, filePart } from "./attachments";
import { galleryItems, openLightbox } from "./lightbox";
import { copyImage, type FileData, imageDeck, imageFigures, isImage, saveBlob } from "./media";

export interface ChatCallbacks {
  /** Resolves true when the POST succeeded; the draft is kept on failure. */
  onSend(parts: PartInput[], clientMessageId: string): Promise<boolean>;
  onUpload(file: File): Promise<string>;
  onStop(): void;
  onModel(provider: string, model: string): void;
  onRename(): void;
  onDelete(): void;
  /** Fork the open session; `messageId` forks from that message, otherwise from the latest. */
  onFork(messageId?: string): void;
  onMove(projectId: string): void;
  onCompact(): void;
  onQueueMode(mode: QueueMode): void;
  onToggleNav(): void;
  /** A subagent card or the parent breadcrumb was clicked. */
  onOpenSession(id: string): void;
}

export interface ModelSel {
  provider: string;
  model: string;
}

export interface ChatHandle {
  /** `titleSuffix` is the session's duplicate-title number, when it has one. */
  update(
    view: SessionView | null,
    providers: ProviderModels[],
    titleSuffix?: number,
    draft?: ModelSel,
    links?: SessionLinks,
  ): void;
  setConnection(open: boolean): void;
  setSendError(message: string | null): void;
  /** Core's part type registry; custom parts look their kind up here. */
  setPartTypes(types: PartType[]): void;
  /** Projects a session can move to. */
  setProjects(projects: Project[]): void;
  /** The agent's default queue mode, for sessions that don't set their own. */
  setDefaultQueueMode(mode: QueueMode): void;
}

const LANDING = ["How are you?", "Ready when you are.", "What should we work on?", "What's on your mind?"];
const MAX_OUTPUT_LINES = 400;
const STICK_PX = 80;
/** Covers the longest message entrance animation in page.ts. */
const ENTER_MS = 320;

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const cap = (s: string): string => (s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1));

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const elapsed = (createdAt: number): string => fmtDuration(Date.now() - createdAt);

/** Drops ANSI escapes from captured tool output: CSI sequences
 * (`\x1b[...m` etc.), OSC sequences (`\x1b]...` closed by BEL or ST), and any
 * lone ESC. Stored output is untouched; this runs at render time only. */
export function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI control chars is the point
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b/g, "");
}

const toolExitCode = (d: Extract<Part["data"], { type: "tool-call" }>): number | undefined => {
  const exit = (d.result as { meta?: { exitCode?: unknown } } | undefined)?.meta?.exitCode;
  return typeof exit === "number" ? exit : undefined;
};

/** A step only shows its time once it has run for more than a second. */
const TIMER_MIN_MS = 1000;

/** Header status for a tool step: `running 0:12` while it runs; a finished
 * step shows `done · exit 0 · 0:12` — the exit code only when the result's
 * meta reports one, the run time from createdAt -> updatedAt. A "done" step
 * with a non-zero exit code is labelled `failed`. Runs of a second or less
 * show no time. */
export function toolStatus(part: Part): string {
  const d = part.data;
  if (d.type !== "tool-call") return "";
  if (d.status === "running") {
    return Date.now() - part.createdAt > TIMER_MIN_MS ? `running ${elapsed(part.createdAt)}` : "running";
  }
  if (d.status === "pending") return d.status;
  const exit = toolExitCode(d);
  const failed = d.status === "done" && exit !== undefined && exit !== 0;
  const bits: string[] = [failed ? "failed" : d.status];
  if (exit !== undefined) bits.push(`exit ${exit}`);
  const ms = part.updatedAt - part.createdAt;
  if (ms > TIMER_MIN_MS) bits.push(fmtDuration(ms));
  return bits.join(" · ");
}

/** Header status for a reasoning step: `thinking 0:05` while it streams, then
 * `complete · 0:12` (quietStatus drops the word, leaving just the run time).
 * Steps of a second or less show no time. */
export function reasoningStatus(part: Part): string {
  if (part.status === "streaming") {
    return Date.now() - part.createdAt > TIMER_MIN_MS ? `thinking ${elapsed(part.createdAt)}` : "thinking";
  }
  const ms = part.updatedAt - part.createdAt;
  return ms > TIMER_MIN_MS ? `${part.status} · ${fmtDuration(ms)}` : part.status;
}

/** Status chip class for a tool row: `failed` when the step errored or a
 * "done" step reported a non-zero exit code, else the raw status. */
export function toolStatusClass(part: Part): string {
  const d = part.data;
  if (d.type !== "tool-call") return part.status;
  const exit = toolExitCode(d);
  if (d.status === "error" || (d.status === "done" && exit !== undefined && exit !== 0)) {
    return "failed";
  }
  return d.status;
}

interface PartUi {
  /** part id -> the subagents its call started. */
  subs: Map<string, SubRow[]>;
  openState: Map<string, boolean>;
  showAll: Map<string, boolean>;
  bodyStick: Map<string, boolean>;
  partTypes: Map<string, PartType>;
  refresh(): void;
}

/** Drops the redundant "complete"/"done" word; keeps exit code and run time. */
export const quietStatus = (label: string): string => label.replace(/^(complete|done)( · )?/, "");

function partRow(
  part: Pick<Part, "id">,
  title: string,
  statusClass: string,
  statusLabel: string,
  defaultOpen: boolean,
  ui: PartUi,
  ...bodyChildren: (Node | string)[]
): HTMLElement {
  const details = el("details", { class: "part-row", "data-part-id": part.id });
  details.open = ui.openState.get(part.id) ?? defaultOpen;
  const summary = el("summary", {}, el("span", { text: title }));
  if (statusLabel !== "") summary.append(el("span", { class: `status ${statusClass}`, text: statusLabel }));
  const body = el("div", { class: "body" }, ...bodyChildren);
  body.addEventListener("scroll", () => {
    ui.bodyStick.set(part.id, body.scrollHeight - body.scrollTop - body.clientHeight < STICK_PX);
  });
  summary.addEventListener("click", () => {
    const opening = !details.open;
    ui.openState.set(part.id, opening);
    details.classList.remove("toggled");
    if (!opening) return;
    // Re-adding an already-present class is a no-op, so flush styles between
    // remove and add to restart the body-in animation on every open.
    void details.offsetWidth;
    details.classList.add("toggled");
  });
  details.append(summary, body);
  return details;
}

function toolBody(part: Part, input: unknown, output: string, ui: PartUi): HTMLElement[] {
  const head =
    typeof input === "object" &&
    input !== null &&
    typeof (input as Record<string, unknown>).command === "string"
      ? `$ ${(input as Record<string, unknown>).command as string}`
      : (JSON.stringify(input, null, 2) ?? "");
  const clean = stripAnsi(output);
  const lines = clean === "" ? [] : clean.split("\n");
  const hidden = ui.showAll.get(part.id) === true ? 0 : Math.max(0, lines.length - MAX_OUTPUT_LINES);
  const children: (Node | string)[] = [];
  if (head !== "") children.push(head, "\n");
  if (hidden > 0) {
    const showAll = iconButton("expand", "Show all", "show-all");
    showAll.addEventListener("click", () => {
      ui.showAll.set(part.id, true);
      ui.refresh();
    });
    children.push(el("span", { class: "trunc" }, `… ${hidden} earlier lines hidden `, showAll), "\n");
  }
  children.push(lines.slice(hidden).join("\n"));
  return [el("pre", {}, ...children)];
}

type CustomData = Extract<PartData, { type: "custom" }>;

const fieldValue = (v: unknown): string => (typeof v === "string" ? v : (JSON.stringify(v) ?? String(v)));

/** "valet-exec 0.1.0", linked to its repository when it has one, and flagged when the plugin is not loaded. */
function partOrigin(kind: string, type: PartType | undefined): HTMLElement {
  const line = el("div", { class: "part-origin" }, kind);
  if (type === undefined) return line;
  const name = `${type.plugin.id} ${type.plugin.version}`;
  const repo = type.plugin.repository;
  line.append(
    " · ",
    repo !== undefined && /^https?:\/\//.test(repo)
      ? el("a", { href: repo, target: "_blank", rel: "noopener noreferrer", text: name })
      : name,
  );
  if (type.loaded === false) line.append(" · not loaded");
  return line;
}

/** A plugin-defined part (9.4): its title collapsed; open, the registry's fields, its text, origin and raw data. Unknown kinds render from title and text alone. */
function customPart(part: Part, d: CustomData, ui: PartUi): HTMLElement {
  const type = ui.partTypes.get(d.kind);
  const view = type?.view;
  const body: HTMLElement[] = [];
  const data = typeof d.data === "object" && d.data !== null ? (d.data as Record<string, unknown>) : {};
  const fields = (view?.fields ?? []).filter((k) => data[k] !== undefined);
  if (fields.length > 0) {
    body.push(
      el(
        "dl",
        { class: "part-fields" },
        ...fields.flatMap((k) => [el("dt", { text: k }), el("dd", { text: fieldValue(data[k]) })]),
      ),
    );
  }
  if (d.text !== "") body.push(el("pre", { text: d.text }));
  body.push(partOrigin(d.kind, type));
  if (d.data !== undefined) {
    body.push(
      partRow(
        { id: `${part.id}/data` },
        "Data",
        "",
        "",
        false,
        ui,
        el("pre", { text: JSON.stringify(d.data, null, 2) }),
      ),
    );
  }
  const row = partRow(part, d.title, "", "", view?.collapsed === false, ui, ...body);
  if (view?.level !== undefined) row.setAttribute("class", `part-row ${view.level}`);
  return row;
}

const isCustomOnly = (cm: ChatMessage): boolean =>
  cm.parts.length > 0 && cm.parts.every((p) => p.data.type === "custom");

/** One subagent call as a card: a row per subagent with its status, each opening that child's session. Stages show as labels when the call has more than one. */
function subagentCard(part: Part, d: ToolData, rows: SubRow[]): HTMLElement {
  const failed = toolStatusClass(part) === "failed" || d.status === "cancelled";
  const live = d.status === "running" || d.status === "pending";
  const states = rows.map((r) => rowState(r, live));
  const busy = states.some((s) => s === "working" || s === "needs you");
  const done = states.filter((s) => s === "done").length;
  const dot = states.includes("needs you")
    ? "attention"
    : busy || live
      ? "running"
      : failed
        ? "failed"
        : "done";
  const tag =
    rows.length > 1 ? `${rows.length} subagents${live ? ` · ${done}/${rows.length} done` : ""}` : "subagent";
  const card = el(
    "div",
    { class: `sub-card${failed ? " failed" : ""}`, "data-part-id": part.id },
    el(
      "div",
      { class: "sub-top" },
      el("span", { class: `dot ${dot}` }),
      el("span", { class: "sub-tag", text: tag }),
      el("span", { class: "sub-status", text: live ? toolStatus(part) : quietStatus(toolStatus(part)) }),
    ),
  );
  const staged = new Set(rows.map((r) => r.stage)).size > 1;
  let stage = 0;
  rows.forEach((row, i) => {
    if (staged && row.stage !== stage) {
      stage = row.stage;
      card.append(el("div", { class: "sub-stage", text: `Stage ${stage}` }));
    }
    const state = states[i] as string;
    const dotClass =
      row.sub?.indicator === "running" || row.sub?.indicator === "attention"
        ? row.sub.indicator
        : row.sub
          ? "done"
          : "idle";
    const inner = [
      el("span", { class: `dot ${dotClass}` }),
      el("span", { class: "sub-title", text: row.title }),
      el("span", { class: "sub-state", text: state }),
    ];
    card.append(
      row.sub === undefined
        ? el("div", { class: "sub-row idle" }, ...inner)
        : el(
            "button",
            { class: "sub-row", "data-open-session": row.sub.session.id },
            ...inner,
            icon("arrowRight"),
          ),
    );
  });
  return card;
}

function renderPart(part: Part, ui: PartUi): HTMLElement | null {
  const d = part.data;
  if (d.type === "tool-call" && isSubagentCall(d)) return subagentCard(part, d, ui.subs.get(part.id) ?? []);
  switch (d.type) {
    case "text":
      return renderMarkdown(d.text);
    case "reasoning":
      return partRow(
        part,
        "Reasoning",
        part.status,
        quietStatus(reasoningStatus(part)),
        part.status === "streaming",
        ui,
        el("pre", { text: d.text }),
      );
    case "tool-call":
      return partRow(
        part,
        d.title ?? d.name,
        toolStatusClass(part),
        quietStatus(toolStatus(part)),
        d.status === "running" || part.status === "streaming",
        ui,
        ...toolBody(part, d.input, d.output ?? "", ui),
      );
    case "notice":
      return el("div", { class: `part-notice ${d.level}`, text: d.text });
    case "file":
      return fileNode(d);
    case "custom":
      return customPart(part, d, ui);
    default:
      return null;
  }
}

/** valet's own compaction reads "Compacted"; a harness names itself. */
function compactionLabel(d: Extract<PartData, { type: "compaction" }>): string {
  const by = d.by === "valet" ? "" : ` (by ${d.by})`;
  switch (d.status) {
    case "in_progress":
      return `Compacting${by}…`;
    case "completed":
      return `Compacted${by}`;
    case "failed":
      return `Compaction failed${by}${d.error ? `: ${d.error}` : ""}`;
    case "cancelled":
      return `Compaction cancelled${by}`;
  }
}

export function fileNode(d: FileData): HTMLElement {
  if (!d.mime.startsWith("image/")) {
    const button = el(
      "button",
      { class: "part-file", type: "button", title: `Download ${d.name}` },
      icon("file"),
      el("span", { text: d.name }),
      icon("import"),
    );
    button.addEventListener("click", () => {
      saveBlob(d.blobId, d.name).catch(() => {
        button.title = `Download failed, click to retry: ${d.name}`;
      });
    });
    return button;
  }
  return imageFigures([d]);
}

/** What the copy button puts on the clipboard. A user message copies all its
 * text; a model message copies only its final response, the trailing run of
 * text after the last tool call or reasoning step. */
export function copyText(cm: ChatMessage): string {
  const texts: string[] = [];
  for (let i = cm.parts.length - 1; i >= 0; i--) {
    const d = (cm.parts[i] as Part).data;
    if (d.type === "text") texts.unshift(d.text);
    else if (cm.message.role === "assistant" && (d.type === "tool-call" || d.type === "reasoning")) break;
  }
  return texts.join("\n\n").trim();
}

function metaModel(cm: ChatMessage): { provider: string; model: string } | undefined {
  const m = cm.message.meta.model;
  if (typeof m !== "object" || m === null) return undefined;
  const r = m as Record<string, unknown>;
  return typeof r.provider === "string" && typeof r.model === "string"
    ? { provider: r.provider, model: r.model }
    : undefined;
}

/** Changes whenever a message would render differently, so unchanged messages
 * keep their DOM (selection, scroll and hover survive streaming elsewhere). */
function messageSig(
  cm: ChatMessage,
  view: SessionView,
  showAll: Map<string, boolean>,
  subs: Map<string, SubRow[]>,
  typesRev: number,
): string {
  const parts = cm.parts.map((p) => {
    const d = p.data;
    const rows = subs.get(p.id);
    const size =
      d.type === "text"
        ? d.text.length
        : d.type === "reasoning"
          ? `${d.text.length}${p.status === "streaming" ? Math.floor(Date.now() / 1000) : ""}`
          : d.type === "tool-call"
            ? `${rows ? rows.map((r) => `${r.title}${r.stage}${r.sub?.session.id}${r.sub?.indicator}`).join("|") : ""}${(d.output ?? "").length}${d.status}${showAll.get(p.id) === true}${d.status === "running" ? Math.floor(Date.now() / 1000) : ""}${p.updatedAt}`
            : d.type === "notice"
              ? d.text.length
              : d.type === "compaction"
                ? d.status
                : d.type === "custom"
                  ? `${d.kind}${d.title}${d.text.length}`
                  : 0;
    return `${p.id}:${p.status}:${d.type}:${size}`;
  });
  const err = cm.message.runId === null ? "" : (view.runErrors.get(cm.message.runId) ?? "");
  const types = cm.parts.some((p) => p.data.type === "custom") ? typesRev : "";
  return `${cm.message.status}|${cm.message.updatedAt}|${err}|${types}|${parts.join(",")}`;
}

/** Renders a message as one or more flow elements: non-error notice parts
 * break out of the bubble into a full-width divider, splitting the message
 * into a new `.msg` chunk on either side. A system message of only custom
 * parts is `bare`: its rows sit in the timeline without the system chrome.
 * `anim` is an entrance class. */
function renderMessage(cm: ChatMessage, ui: PartUi, view: SessionView, anim: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const msgs: HTMLElement[] = [];
  const fx = anim === "" ? "" : ` ${anim}`;
  const bare = cm.message.role === "system" && isCustomOnly(cm) ? " bare" : "";
  // A user's images become one deck above their text; a run of presented
  // images becomes one group of figures.
  const user = cm.message.role === "user";
  const deckImages = user ? cm.parts.map((p) => p.data).filter(isImage) : [];
  let deck: HTMLElement | null = deckImages.length > 0 ? imageDeck(deckImages) : null;
  let bubble: HTMLElement | null = null;
  const currentBubble = (): HTMLElement => {
    if (bubble === null) {
      bubble = el("div", { class: "bubble" });
      const msg = el("div", { class: `msg ${cm.message.role}${bare}${fx}` }, ...(deck ? [deck] : []), bubble);
      deck = null;
      msgs.push(msg);
      out.push(msg);
    }
    return bubble;
  };
  let run: FileData[] = [];
  const flushRun = (): void => {
    if (run.length > 0) currentBubble().append(imageFigures(run));
    run = [];
  };
  for (const part of cm.parts) {
    const d = part.data;
    if (isImage(d)) {
      if (!user) run.push(d);
      continue;
    }
    flushRun();
    if (d.type === "notice" && d.level !== "error") {
      bubble = null;
      out.push(el("div", { class: `divider ${d.level}${fx}` }, el("span", { text: d.text })));
      continue;
    }
    if (d.type === "compaction") {
      bubble = null;
      out.push(
        el(
          "div",
          { class: `divider ${d.status === "failed" ? "warn" : "info"}${fx}` },
          el("span", { text: compactionLabel(d) }),
        ),
      );
      continue;
    }
    const node = renderPart(part, ui);
    if (node !== null) currentBubble().append(node);
  }
  flushRun();
  if (deck !== null) {
    const msg = el("div", { class: `msg ${cm.message.role}${fx}` }, deck);
    msgs.push(msg);
    out.push(msg);
  }
  if (cm.parts.length === 0) {
    const b = currentBubble();
    if (cm.message.status === "error") {
      const runError = cm.message.runId === null ? undefined : view.runErrors.get(cm.message.runId);
      b.append(
        el("div", {
          class: "part-notice error",
          text: runError === undefined ? "Error" : `Error — ${runError}`,
        }),
      );
    } else if (cm.message.status === "streaming") {
      b.append(el("span", { class: "hint", text: "…" }));
    }
  }
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg !== undefined) {
    const assistant = cm.message.role === "assistant";
    const mm = metaModel(cm);
    const shown = assistant && mm !== undefined && mm.model !== "" ? mm : undefined;
    const meta: string[] = [];
    if (shown !== undefined) meta.push(shown.model);
    if (cm.message.status !== "complete") meta.push(cm.message.status);
    const copyable = cm.message.status === "complete" && copyText(cm) !== "";
    const forkable = cm.message.status === "complete" && (cm.message.role === "user" || assistant);
    if (meta.length > 0 || copyable || forkable) {
      const line = el("div", { class: "meta" });
      if (copyable) {
        const btn = iconButton("copy", "Copy", "copy-btn");
        btn.dataset.copyId = cm.message.id;
        line.append(btn);
      }
      if (forkable) {
        const fork = iconButton("branch", "Fork from here", "fork-btn");
        fork.setAttribute("data-fork-id", cm.message.id);
        line.append(fork);
      }
      const logo = shown === undefined ? undefined : logoFor(shown.model, shown.provider);
      if (logo !== undefined) line.append(logoMark(logo));
      if (meta.length > 0) line.append(meta.join(" · "));
      lastMsg.append(line);
    }
  }
  return out;
}

function pickVariant(f: ModelFamily): ModelVariant {
  return (
    f.variants.find((v) => v.effort === "high") ??
    f.variants.find((v) => v.effort === "medium") ??
    (f.variants[0] as ModelVariant)
  );
}

function contextWindow(view: SessionView, providers: ProviderModels[]): number | undefined {
  let sel = view.session.settings.model;
  for (let i = view.messages.length - 1; i >= 0; i--) {
    const cm = view.messages[i] as ChatMessage;
    if (cm.message.role !== "assistant") continue;
    const m = metaModel(cm);
    if (m !== undefined) {
      sel = m;
      break;
    }
  }
  if (sel !== undefined) {
    const win = providers
      .find((p) => p.provider === sel.provider)
      ?.models.find((m) => m.id === sel.model)?.contextWindow;
    if (win !== undefined && win > 0) return win;
  }
  return view.contextWindow ?? undefined;
}

/** The landing page's model: the user's pick, else the first provider's first family. */
function draftPick(draft: ModelSel | undefined, providers: ProviderModels[]): ModelSel | undefined {
  if (draft !== undefined) return draft;
  const first = groupModels(providers).find((f) => !f.more);
  return first === undefined ? undefined : { provider: first.provider, model: pickVariant(first).id };
}

function flashCopy(btn: HTMLButtonElement, name: "check" | "close", label: string): void {
  const was = btn.title;
  btn.replaceChildren(icon(name));
  btn.title = label;
  btn.setAttribute("aria-label", label);
  setTimeout(() => {
    btn.replaceChildren(icon("copy"));
    btn.title = was;
    btn.setAttribute("aria-label", was);
  }, 1500);
}

export function createChat(root: HTMLElement, cb: ChatCallbacks): ChatHandle {
  const navToggle = iconButton("sidebar", "Sessions", "nav-toggle");
  const title = el("span", { class: "session-title" });
  const titleNum = el("span", { class: "suffix" });
  titleNum.style.display = "none";
  const subTag = el("span", { class: "sub-tag", text: "subagent" });
  subTag.style.display = "none";
  const crumbText = el("span", { class: "crumb-text" });
  const crumb = el(
    "button",
    { class: "crumb", "aria-label": "Back to parent session" },
    icon("arrowLeft"),
    crumbText,
  );
  crumb.style.display = "none";
  let parentId: string | null = null;
  crumb.addEventListener("click", () => {
    if (parentId !== null) cb.onOpenSession(parentId);
  });
  const forkCrumbText = el("span", { class: "crumb-text" });
  const forkCrumb = el(
    "button",
    { class: "crumb", "aria-label": "Open the session this was forked from" },
    icon("branch"),
    forkCrumbText,
  );
  forkCrumb.style.display = "none";
  let forkSourceId: string | null = null;
  forkCrumb.addEventListener("click", () => {
    if (forkSourceId !== null) cb.onOpenSession(forkSourceId);
  });
  const modelChip = chipButton("model", icon("sparkles"), "Model");
  const effortChip = chipButton("effort", icon("gauge"), "Effort");
  const ring = el("span", { class: "ring" });
  const tip = el("span", { class: "tip", role: "tooltip" });
  const queuedBadge = el("span", { class: "queued-badge", role: "status" });
  queuedBadge.style.display = "none";
  const contextBar = el("div", { class: "context-bar", tabindex: "0", role: "img" }, ring, tip);
  const messages = el("div", { class: "messages" });
  const connLine = el("div", { class: "hint conn", text: "Reconnecting…" });
  const sendErr = el("div", { class: "hint send-error" });
  sendErr.style.display = "none";
  const textarea = el("textarea", { placeholder: "Message…", rows: "1", enterkeyhint: "enter" });
  const send = iconButton("send", "Send", "send");
  const stop = iconButton("stop", "Stop", "stop");
  stop.style.display = "none";
  const attachBtn = iconButton("paperclip", "Attach", "attach");
  const imageInput = el("input", { type: "file", accept: "image/*", multiple: "", hidden: "" });
  const fileInput = el("input", { type: "file", multiple: "", hidden: "" });

  let current: SessionView | null = null;
  let sessionId: string | null = null;
  const openState = new Map<string, boolean>();
  const showAll = new Map<string, boolean>();
  const bodyStick = new Map<string, boolean>();
  const partTypes = new Map<string, PartType>();
  let typesRev = 0;
  const cache = new Map<string, { sig: string; nodes: HTMLElement[]; anim: string; born: number }>();
  let primed = false;
  let leadKey = "sparkles"; // matches the chip's initial icon
  let stickToBottom = true;
  let connOpen = false;
  let draftId: string | null = null;
  let families: ModelFamily[] = [];
  let activeFamily: ModelFamily | null = null;
  let activeVariant: ModelVariant | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;

  const familyLogo = (f: ModelFamily): HTMLElement => {
    const logo = logoFor(`${f.label} ${f.key}`, f.provider);
    return logo === undefined ? icon("sparkles") : logoMark(logo);
  };
  const modelMenu = popover(
    modelChip.button,
    () => {
      const sections = new Map<string, MenuSection>();
      const more: MenuSection = { title: "More variants", items: [] };
      for (const f of families) {
        let s = f.more ? more : sections.get(f.provider);
        if (s === undefined) {
          s = { title: f.providerLabel, items: [] };
          sections.set(f.provider, s);
        }
        s.items.push({
          label: f.label,
          lead: familyLogo(f),
          selected: f === activeFamily,
          onSelect: () => cb.onModel(f.provider, pickVariant(f).id),
        });
      }
      return [...sections.values(), ...(more.items.length > 0 ? [more] : [])];
    },
    "model-pop",
    true,
  );
  const effortMenu = popover(
    effortChip.button,
    () => {
      const f = activeFamily;
      if (f === null) return [];
      const items = f.variants.map((v) => ({
        label: cap(v.effort),
        selected: v === activeVariant,
        onSelect: () => cb.onModel(f.provider, v.id),
      }));
      return [{ title: "Effort", items }];
    },
    "effort-pop",
  );

  const syncSend = (): void => {
    send.disabled = textarea.value.trim() === "" && attachments.list().length === 0;
  };
  const attachments = createAttachments({
    upload: cb.onUpload,
    onError: (message) => setSendError(message),
    onChange: syncSend,
  });
  const doSend = (): void => {
    const text = textarea.value.trim();
    const sent = attachments.list();
    if (text === "" && sent.length === 0) return;
    draftId ??= crypto.randomUUID();
    const id = draftId;
    const files = Promise.all(sent.map(async (a) => filePart(await a.blob, a.file)));
    void files
      .then((fileParts) => {
        const textParts: PartInput[] = text === "" ? [] : [{ type: "text", text }];
        return cb.onSend([...textParts, ...fileParts], id);
      })
      .then(
        (ok) => {
          if (!ok) return;
          if (textarea.value.trim() === text) {
            textarea.value = "";
            textarea.style.height = "";
          }
          attachments.drop(sent);
          if (draftId === id) draftId = null;
          syncSend();
        },
        () => {},
      );
  };
  send.addEventListener("click", doSend);
  stop.addEventListener("click", () => cb.onStop());
  navToggle.addEventListener("click", () => cb.onToggleNav());
  textarea.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.isComposing) return;
    // Touch keyboards: Enter inserts a newline; the Send button sends.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (!ev.shiftKey) {
      ev.preventDefault();
      doSend();
    }
  });
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    syncSend();
  });
  textarea.addEventListener("paste", (ev) => {
    const files = Array.from(ev.clipboardData?.files ?? []);
    if (files.length === 0) return;
    ev.preventDefault();
    attachments.add(files);
  });
  for (const input of [imageInput, fileInput]) {
    input.addEventListener("change", () => {
      attachments.add(Array.from(input.files ?? []));
      input.value = "";
    });
  }
  const attachMenu = popover(
    attachBtn,
    () => [
      {
        items: [
          { label: "Image", lead: icon("image"), onSelect: () => imageInput.click() },
          { label: "File", lead: icon("file"), onSelect: () => fileInput.click() },
        ],
      },
    ],
    "attach-pop",
  );
  // Delegated: morph() keeps the old button node on re-render, so the text is
  // looked up from the current view at click time rather than captured.
  messages.addEventListener("click", (ev) => {
    const open = (ev.target as Element | null)?.closest<HTMLElement>(".sub-row")?.dataset.openSession;
    if (open !== undefined) {
      cb.onOpenSession(open);
      return;
    }
    if (mediaClick(ev.target as Element | null)) return;
    const forkId = (ev.target as Element | null)?.closest<HTMLElement>(".fork-btn")?.dataset.forkId;
    if (forkId !== undefined) {
      cb.onFork(forkId);
      return;
    }
    const btn = (ev.target as Element | null)?.closest<HTMLButtonElement>(".copy-btn");
    const id = btn?.dataset.copyId;
    if (btn === null || btn === undefined || id === undefined) return;
    const cm = current?.messages.find((m) => m.message.id === id);
    if (cm === undefined) return;
    navigator.clipboard.writeText(copyText(cm)).then(
      () => flashCopy(btn, "check", "Copied"),
      () => flashCopy(btn, "close", "Copy failed"),
    );
  });
  /** Image clicks: open the lightbox, download, or copy. True when handled. */
  function mediaClick(target: Element | null): boolean {
    const save = target?.closest<HTMLElement>("[data-save]");
    if (save) {
      saveBlob(save.dataset.save ?? "", save.dataset.name ?? "").catch(() => setSendError("Download failed"));
      return true;
    }
    const copy = target?.closest<HTMLButtonElement>("[data-copy-image]");
    if (copy) {
      copyImage(copy.dataset.copyImage ?? "").then(
        () => flashCopy(copy, "check", "Copied"),
        () => flashCopy(copy, "close", "Copy failed"),
      );
      return true;
    }
    const view = target?.closest<HTMLElement>("[data-view]");
    const gallery = view?.closest<HTMLElement>("[data-gallery]");
    if (!view || !gallery) return false;
    const items = galleryItems(gallery.closest(".msg") ?? gallery);
    const at = items.findIndex((it) => it.file.blobId === view.dataset.view);
    openLightbox(items, Math.max(0, at), gallery.dataset.gallery ?? "", setSendError);
    return true;
  }
  messages.addEventListener("scroll", () => {
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < STICK_PX;
  });

  let projects: Project[] = [];
  let defaultMode: QueueMode = "queue";
  const sessionMenu = popover(
    iconButton("more", "Session actions", "session-menu"),
    () => {
      const session = current?.session;
      const mode = session === undefined ? defaultMode : queueModeOf(session, defaultMode);
      const targets = projects.filter((p) => p.id !== session?.projectId);
      const sections: MenuSection[] = [
        {
          items: [
            { label: "Rename", lead: icon("pencil"), onSelect: () => cb.onRename() },
            { label: "Fork", lead: icon("branch"), onSelect: () => cb.onFork() },
            { label: "Compact", lead: icon("compact"), onSelect: () => cb.onCompact() },
          ],
        },
        {
          title: "New messages while running",
          items: [
            { label: "Queue", selected: mode === "queue", onSelect: () => cb.onQueueMode("queue") },
            {
              label: "Interrupt",
              selected: mode === "interrupt",
              onSelect: () => cb.onQueueMode("interrupt"),
            },
          ],
        },
      ];
      if (targets.length > 0)
        sections.push({
          title: "Move to project",
          items: targets.map((p) => ({
            label: p.name,
            lead: icon("folder"),
            onSelect: () => cb.onMove(p.id),
          })),
        });
      sections.push({ items: [{ label: "Delete", lead: icon("trash"), onSelect: () => cb.onDelete() }] });
      return sections;
    },
    "session-actions",
  );
  sessionMenu.style.display = "none";

  const main = el(
    "div",
    { class: "main" },
    el(
      "div",
      { class: "chat-header" },
      navToggle,
      el(
        "div",
        { class: "title-group" },
        crumb,
        forkCrumb,
        el("div", { class: "title-line" }, title, titleNum, subTag),
      ),
      sessionMenu,
    ),
    messages,
    el(
      "div",
      { class: "composer-wrap" },
      connLine,
      sendErr,
      el(
        "div",
        { class: "composer" },
        attachments.row,
        textarea,
        el(
          "div",
          { class: "composer-bar" },
          el("div", { class: "controls" }, attachMenu, modelMenu, effortMenu),
          el("div", { class: "actions" }, queuedBadge, contextBar, stop, send),
        ),
        imageInput,
        fileInput,
      ),
    ),
  );
  root.replaceChildren(main);
  syncSend();
  setContext(null);
  setModels(null, null);

  let subs: SubInfo[] = [];

  function renderMessages(view: SessionView): void {
    const scrollTops = new Map<string, number>();
    for (const row of messages.querySelectorAll<HTMLElement>(".part-row")) {
      const body = row.querySelector<HTMLElement>(".body");
      const pid = row.dataset.partId;
      if (body !== null && pid !== undefined && body.scrollTop > 0) {
        scrollTops.set(pid, body.scrollTop);
      }
    }
    const runningTools = new Set<string>();
    let liveReasoning = false;
    for (const cm of view.messages) {
      for (const p of cm.parts) {
        if (p.data.type === "tool-call" && p.data.status === "running") runningTools.add(p.id);
        if (p.data.type === "reasoning" && p.status === "streaming") liveReasoning = true;
      }
    }
    const bound = bindSubs(view.messages, subs);
    const ui: PartUi = {
      subs: bound,
      openState,
      showAll,
      bodyStick,
      partTypes,
      refresh: () => {
        if (current !== null) renderMessages(current);
      },
    };
    const now = Date.now();
    const live = new Set<string>();
    const nodes: HTMLElement[] = [];
    for (const cm of view.messages) {
      const id = cm.message.id;
      const sig = messageSig(cm, view, showAll, bound, typesRev);
      let hit = cache.get(id);
      if (hit === undefined || hit.sig !== sig) {
        // New messages animate in once; a re-render mid-entrance resumes it.
        const born = hit?.born ?? now;
        const anim = hit === undefined ? (primed ? "enter" : "fade") : now - born < ENTER_MS ? hit.anim : "";
        const fresh = renderMessage(cm, ui, view, anim);
        if (hit !== undefined && hit.nodes.length === fresh.length) {
          // Same shape: patch the live nodes so hover, focus and scroll survive.
          hit.nodes.forEach((n, i) => {
            morph(n, fresh[i] as HTMLElement);
          });
          hit = { ...hit, sig, anim };
        } else {
          if (anim !== "" && born < now) for (const n of fresh) n.style.animationDelay = `${born - now}ms`;
          hit = { sig, anim, born, nodes: fresh };
        }
        cache.set(id, hit);
      }
      live.add(id);
      nodes.push(...hit.nodes);
    }
    primed = true;
    for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    if (view.messages.length === 0) nodes.push(el("div", { class: "empty", text: "No messages yet" }));
    reconcile(messages, nodes);
    for (const row of messages.querySelectorAll<HTMLElement>(".part-row")) {
      const pid = row.dataset.partId;
      const body = row.querySelector<HTMLElement>(".body");
      if (pid === undefined || body === null) continue;
      if (runningTools.has(pid) && (bodyStick.get(pid) ?? true)) {
        body.scrollTop = body.scrollHeight;
      } else {
        const st = scrollTops.get(pid);
        if (st !== undefined) body.scrollTop = st;
      }
    }
    if (stickToBottom) messages.scrollTop = messages.scrollHeight;
    syncTick(runningTools.size > 0 || liveReasoning);
  }

  function syncTick(anyRunning: boolean): void {
    if (anyRunning && tick === undefined) {
      tick = setInterval(() => {
        if (!main.isConnected) {
          clearInterval(tick);
          tick = undefined;
          return;
        }
        if (current !== null) renderMessages(current);
      }, 1000);
    } else if (!anyRunning && tick !== undefined) {
      clearInterval(tick);
      tick = undefined;
    }
  }

  function rebuildModels(selected: ModelSel | undefined, providers: ProviderModels[]): void {
    families = groupModels(providers);
    let sel =
      selected === undefined
        ? undefined
        : families.find(
            (f) => f.provider === selected.provider && f.variants.some((v) => v.id === selected.model),
          );
    if (selected !== undefined && sel === undefined) {
      sel = {
        key: familyOf(selected.model).family,
        provider: selected.provider,
        providerLabel: selected.provider,
        label: `${selected.model} (${selected.provider})`,
        more: false,
        variants: [{ id: selected.model, name: selected.model, effort: "default" }],
      };
      families.unshift(sel);
    }
    setModels(
      sel ?? null,
      sel === undefined ? null : (sel.variants.find((v) => v.id === selected?.model) ?? pickVariant(sel)),
    );
  }

  function setModels(f: ModelFamily | null, v: ModelVariant | null): void {
    activeFamily = f;
    activeVariant = v;
    // Key on the rendered icon, not the model: the lead animates on insert,
    // so only swap (and replay) when the icon itself changes.
    const logo = f === null ? undefined : logoFor(`${f.label} ${f.key}`, f.provider);
    const key = logo === undefined ? "sparkles" : `logo:${logo}`;
    if (key !== leadKey) {
      leadKey = key;
      modelChip.lead.replaceChildren(logo === undefined ? icon("sparkles") : logoMark(logo));
    }
    modelChip.text.textContent = f?.label ?? "No model";
    modelChip.button.disabled = families.length === 0;
    effortMenu.style.display = f === null || f.variants.length <= 1 ? "none" : "";
    effortChip.text.textContent = v === null ? "" : cap(v.effort);
  }

  connLine.style.display = connOpen ? "none" : "";

  /** Ring fill only; the exact numbers live in the hover/focus tip. Hidden
   * until a run reports usage. */
  function setContext(tokens: number | null, win?: number): void {
    contextBar.style.display = tokens === null ? "none" : "";
    if (tokens === null) return;
    const pct = win !== undefined && win > 0 ? Math.min(100, (tokens / win) * 100) : 0;
    ring.style.setProperty("--fill", `${pct}%`);
    ring.className = `ring${pct >= 90 ? " hot" : pct >= 70 ? " warm" : ""}`;
    tip.textContent =
      win === undefined
        ? `${fmtTokens(tokens)} tokens`
        : `${fmtTokens(tokens)} / ${fmtTokens(win)} tokens · ${Math.round(pct)}%`;
    contextBar.setAttribute("aria-label", `Context: ${tip.textContent}`);
  }

  const setSendError = (message: string | null): void => {
    sendErr.textContent = message ?? "";
    sendErr.style.display = message === null ? "none" : "";
  };

  return {
    update(view, providers, titleSuffix, draft, links) {
      current = view;
      subs = links?.subs ?? [];
      parentId = links?.parent?.id ?? null;
      const sid = view?.session.id ?? null;
      if (sid !== sessionId) {
        sessionId = sid;
        openState.clear();
        showAll.clear();
        bodyStick.clear();
        cache.clear();
        primed = false;
        stickToBottom = true;
      }

      if (view === null) main.setAttribute("data-landing", "");
      else main.removeAttribute("data-landing");
      if (view === null) {
        title.textContent = "";
        titleNum.style.display = "none";
        subTag.style.display = "none";
        crumb.style.display = "none";
        forkCrumb.style.display = "none";
        queuedBadge.style.display = "none";
        sessionMenu.style.display = "none";
        rebuildModels(draftPick(draft, providers), providers);
        if (messages.querySelector(".landing") === null) {
          clear(messages);
          messages.append(
            el("div", {
              class: "landing",
              text: LANDING[Math.floor(Math.random() * LANDING.length)] as string,
            }),
          );
        }
        stop.style.display = "none";
        setContext(null);
        syncSend();
        syncTick(false);
        return;
      }

      title.textContent = view.session.title ?? "Untitled";
      sessionMenu.style.display = "";
      subTag.style.display = view.session.parentSessionId === null ? "none" : "";
      crumb.style.display = links?.parent === undefined ? "none" : "";
      crumbText.textContent = links?.parent?.title ?? "Untitled";
      forkSourceId = links?.forkedFrom?.id ?? null;
      forkCrumb.style.display = forkSourceId === null ? "none" : "";
      forkCrumbText.textContent = `Forked from ${links?.forkedFrom?.title ?? "Untitled"}`;
      queuedBadge.style.display = view.queued > 0 ? "" : "none";
      queuedBadge.textContent = `${view.queued} queued`;
      if (titleSuffix !== undefined) {
        titleNum.textContent = `#${titleSuffix}`;
        titleNum.style.display = "";
      } else {
        titleNum.style.display = "none";
      }
      rebuildModels(view.session.settings.model, providers);
      stop.style.display = view.activeRunId === null ? "none" : "";

      setContext(view.contextTokens, contextWindow(view, providers));
      syncSend();
      renderMessages(view);
    },
    setConnection(open) {
      connOpen = open;
      connLine.style.display = open ? "none" : "";
      if (open) setSendError(null);
    },
    setSendError,
    setProjects(list) {
      projects = list;
    },
    setDefaultQueueMode(mode) {
      defaultMode = mode;
    },
    setPartTypes(types) {
      partTypes.clear();
      for (const t of types) partTypes.set(t.id, t);
      typesRev++;
      if (current !== null) renderMessages(current);
    },
  };
}
