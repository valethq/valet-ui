import { clear, el } from "../dom";
import { chipButton, icon, iconButton } from "../icons";
import { logoFor, logoMark } from "../logos";
import { type MenuSection, popover } from "../menu";
import { renderMarkdown } from "../markdown";
import { familyOf, groupModels, type ModelFamily, type ModelVariant } from "../models";
import type { Indicator, SessionView } from "../state";
import type { ChatMessage, Part, ProviderModels } from "../types";

export interface ChatCallbacks {
  /** Resolves true when the POST succeeded; the draft is kept on failure. */
  onSend(text: string, clientMessageId: string): Promise<boolean>;
  onStop(): void;
  onModel(provider: string, model: string): void;
  onToggleNav(): void;
}

export interface ChatHandle {
  /** `titleSuffix` is the session's duplicate-title number, when it has one. */
  update(
    view: SessionView | null,
    providers: ProviderModels[],
    titleSuffix?: number,
    indicator?: Indicator,
  ): void;
  setConnection(open: boolean): void;
  setSendError(message: string | null): void;
}

const MAX_OUTPUT_LINES = 400;
const STICK_PX = 80;

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

/** Header status for a tool step: `running 0:12` while it runs; a finished
 * step shows `done · exit 0 · 0:12` — the exit code only when the result's
 * meta reports one, the run time from createdAt -> updatedAt. A "done" step
 * with a non-zero exit code is labelled `failed`. */
export function toolStatus(part: Part): string {
  const d = part.data;
  if (d.type !== "tool-call") return "";
  if (d.status === "running") return `running ${elapsed(part.createdAt)}`;
  if (d.status === "pending") return d.status;
  const exit = toolExitCode(d);
  const failed = d.status === "done" && exit !== undefined && exit !== 0;
  const bits: string[] = [failed ? "failed" : d.status];
  if (exit !== undefined) bits.push(`exit ${exit}`);
  bits.push(fmtDuration(part.updatedAt - part.createdAt));
  return bits.join(" · ");
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
  openState: Map<string, boolean>;
  showAll: Map<string, boolean>;
  refresh(): void;
}

/** Drops the redundant "complete"/"done" word; keeps exit code and run time. */
export const quietStatus = (label: string): string => label.replace(/^(complete|done)( · )?/, "");

function partRow(
  part: Part,
  title: string,
  statusClass: string,
  statusLabel: string,
  defaultOpen: boolean,
  ui: PartUi,
  ...bodyChildren: (Node | string)[]
): HTMLElement {
  const details = el("details", { class: "part-row", "data-part-id": part.id });
  details.open = ui.openState.get(part.id) ?? defaultOpen;
  const summary = el(
    "summary",
    {},
    el("span", { text: title }),
    el("span", { class: `status ${statusClass}`, text: statusLabel }),
  );
  summary.addEventListener("click", () => ui.openState.set(part.id, !details.open));
  details.append(summary, el("div", { class: "body" }, ...bodyChildren));
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

function renderPart(part: Part, ui: PartUi): HTMLElement | null {
  const d = part.data;
  switch (d.type) {
    case "text":
      return renderMarkdown(d.text);
    case "reasoning":
      return partRow(
        part,
        "Reasoning",
        part.status,
        quietStatus(part.status),
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
    case "compaction-summary":
      return el("div", { class: "part-summary", text: `Context compacted — ${d.text}` });
    case "file":
      return el("div", { class: "part-notice", text: `file: ${d.name}` });
    default:
      return null;
  }
}

function metaModel(cm: ChatMessage): { provider: string; model: string } | undefined {
  const m = cm.message.meta.model;
  if (typeof m !== "object" || m === null) return undefined;
  const r = m as Record<string, unknown>;
  return typeof r.provider === "string" && typeof r.model === "string"
    ? { provider: r.provider, model: r.model }
    : undefined;
}

/** Renders a message as one or more flow elements: non-error notice parts
 * break out of the bubble into a full-width divider, splitting the message
 * into a new `.msg` chunk on either side. */
function renderMessage(cm: ChatMessage, ui: PartUi, view: SessionView): HTMLElement[] {
  const out: HTMLElement[] = [];
  const msgs: HTMLElement[] = [];
  let bubble: HTMLElement | null = null;
  const currentBubble = (): HTMLElement => {
    if (bubble === null) {
      bubble = el("div", { class: "bubble" });
      const msg = el("div", { class: `msg ${cm.message.role}` }, bubble);
      msgs.push(msg);
      out.push(msg);
    }
    return bubble;
  };
  for (const part of cm.parts) {
    const d = part.data;
    if (d.type === "notice" && d.level !== "error") {
      bubble = null;
      out.push(el("div", { class: `divider ${d.level}` }, el("span", { text: d.text })));
      continue;
    }
    const node = renderPart(part, ui);
    if (node !== null) currentBubble().append(node);
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
    const meta: string[] = assistant ? [] : [cm.message.role];
    if (shown !== undefined) meta.push(shown.model);
    if (cm.message.status !== "complete") meta.push(cm.message.status);
    if (meta.length > 0) {
      const line = el("div", { class: "meta" });
      const logo = shown === undefined ? undefined : logoFor(shown.model, shown.provider);
      if (logo !== undefined) line.append(logoMark(logo));
      line.append(meta.join(" · "));
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

export function createChat(root: HTMLElement, cb: ChatCallbacks): ChatHandle {
  const navToggle = iconButton("sidebar", "Sessions", "nav-toggle");
  const title = el("span", { class: "session-title" });
  const titleNum = el("span", { class: "suffix" });
  titleNum.style.display = "none";
  const sessionDot = el("span", { class: "session-dot" });
  const modelChip = chipButton("model", icon("sparkles"), "Model");
  const effortChip = chipButton("effort", icon("gauge"), "Effort");
  const ring = el("span", { class: "ring" });
  const tip = el("span", { class: "tip", role: "tooltip" });
  const contextBar = el("div", { class: "context-bar", tabindex: "0", role: "img" }, ring, tip);
  const messages = el("div", { class: "messages" });
  const connLine = el("div", { class: "hint conn", text: "Reconnecting…" });
  const sendErr = el("div", { class: "hint send-error" });
  sendErr.style.display = "none";
  const textarea = el("textarea", { placeholder: "Message…", rows: "1", enterkeyhint: "enter" });
  const send = iconButton("send", "Send", "send");
  const stop = iconButton("stop", "Stop", "stop");
  stop.style.display = "none";

  let current: SessionView | null = null;
  let sessionId: string | null = null;
  const openState = new Map<string, boolean>();
  const showAll = new Map<string, boolean>();
  const bodyStick = new Map<string, boolean>();
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
    send.disabled = current === null || textarea.value.trim() === "";
  };
  const doSend = (): void => {
    const text = textarea.value.trim();
    if (text === "" || current === null) return;
    draftId ??= crypto.randomUUID();
    const id = draftId;
    void cb.onSend(text, id).then((ok) => {
      if (!ok) return;
      if (textarea.value.trim() === text) {
        textarea.value = "";
        textarea.style.height = "";
        syncSend();
      }
      if (draftId === id) draftId = null;
    });
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
  messages.addEventListener("scroll", () => {
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < STICK_PX;
  });

  const main = el(
    "div",
    { class: "main" },
    el("div", { class: "chat-header" }, navToggle, sessionDot, title, titleNum),
    messages,
    el(
      "div",
      { class: "composer-wrap" },
      connLine,
      sendErr,
      el(
        "div",
        { class: "composer" },
        textarea,
        el(
          "div",
          { class: "composer-bar" },
          el("div", { class: "controls" }, modelMenu, effortMenu),
          el("div", { class: "actions" }, contextBar, stop, send),
        ),
      ),
    ),
  );
  root.replaceChildren(main);
  syncSend();
  setContext(null);
  setModels(null, null);

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
    for (const cm of view.messages) {
      for (const p of cm.parts) {
        if (p.data.type === "tool-call" && p.data.status === "running") runningTools.add(p.id);
      }
    }
    const ui: PartUi = { openState, showAll, refresh: () => renderMessages(view) };
    clear(messages);
    for (const cm of view.messages) messages.append(...renderMessage(cm, ui, view));
    if (view.messages.length === 0) {
      messages.append(el("div", { class: "empty", text: "No messages yet" }));
    }
    for (const row of messages.querySelectorAll<HTMLElement>(".part-row")) {
      const pid = row.dataset.partId;
      const body = row.querySelector<HTMLElement>(".body");
      if (pid === undefined || body === null) continue;
      body.addEventListener("scroll", () => {
        bodyStick.set(pid, body.scrollHeight - body.scrollTop - body.clientHeight < STICK_PX);
      });
      if (runningTools.has(pid) && (bodyStick.get(pid) ?? true)) {
        body.scrollTop = body.scrollHeight;
      } else {
        const st = scrollTops.get(pid);
        if (st !== undefined) body.scrollTop = st;
      }
    }
    if (stickToBottom) messages.scrollTop = messages.scrollHeight;
    syncTick(runningTools.size > 0);
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

  function rebuildModels(view: SessionView, providers: ProviderModels[]): void {
    const selected = view.session.settings.model;
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
    modelChip.lead.replaceChildren(f === null ? icon("sparkles") : familyLogo(f));
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
    ring.style.background = `conic-gradient(var(--ring) ${pct}%, var(--strong) 0)`;
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
    update(view, providers, titleSuffix, indicator = "done") {
      sessionDot.className = `session-dot ${view === null ? "none" : indicator}`;
      current = view;
      const sid = view?.session.id ?? null;
      if (sid !== sessionId) {
        sessionId = sid;
        openState.clear();
        showAll.clear();
        bodyStick.clear();
        stickToBottom = true;
      }

      if (view === null) {
        title.textContent = "";
        titleNum.style.display = "none";
        families = [];
        setModels(null, null);
        clear(messages);
        messages.append(el("div", { class: "empty", text: "Select a session" }));
        stop.style.display = "none";
        setContext(null);
        syncSend();
        syncTick(false);
        return;
      }

      title.textContent = view.session.title ?? "Untitled";
      if (titleSuffix !== undefined) {
        titleNum.textContent = `#${titleSuffix}`;
        titleNum.style.display = "";
      } else {
        titleNum.style.display = "none";
      }
      rebuildModels(view, providers);
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
  };
}
