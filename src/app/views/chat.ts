import { clear, el } from "../dom";
import { renderMarkdown } from "../markdown";
import { familyOf, groupModels, type ModelFamily, type ModelVariant } from "../models";
import type { SessionView } from "../state";
import type { ChatMessage, Part, ProviderModels } from "../types";

export interface ChatCallbacks {
  /** Resolves true when the POST succeeded; the draft is kept on failure. */
  onSend(text: string, clientMessageId: string): Promise<boolean>;
  onStop(): void;
  onModel(provider: string, model: string): void;
  onToggleNav(): void;
}

export interface ChatHandle {
  update(view: SessionView | null, providers: ProviderModels[]): void;
  setConnection(open: boolean): void;
}

const MAX_OUTPUT_LINES = 400;
const STICK_PX = 80;

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const cap = (s: string): string => (s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1));

function elapsed(createdAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface PartUi {
  openState: Map<string, boolean>;
  showAll: Map<string, boolean>;
  refresh(): void;
}

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
  const lines = output === "" ? [] : output.split("\n");
  const hidden = ui.showAll.get(part.id) === true ? 0 : Math.max(0, lines.length - MAX_OUTPUT_LINES);
  const children: (Node | string)[] = [];
  if (head !== "") children.push(head, "\n");
  if (hidden > 0) {
    const showAll = el("button", { class: "show-all", text: "Show all" });
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
        part.status,
        part.status === "streaming",
        ui,
        el("pre", { text: d.text }),
      );
    case "tool-call": {
      const statusLabel = d.status === "running" ? `running ${elapsed(part.createdAt)}` : d.status;
      return partRow(
        part,
        d.title ?? d.name,
        d.status,
        statusLabel,
        d.status === "running" || part.status === "streaming",
        ui,
        ...toolBody(part, d.input, d.output ?? "", ui),
      );
    }
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

function renderMessage(cm: ChatMessage, ui: PartUi, view: SessionView): HTMLElement {
  const msg = el("div", { class: `msg ${cm.message.role}` });
  const bubble = el("div", { class: "bubble" });
  for (const part of cm.parts) {
    const node = renderPart(part, ui);
    if (node !== null) bubble.append(node);
  }
  if (cm.parts.length === 0) {
    if (cm.message.status === "error") {
      const runError = cm.message.runId === null ? undefined : view.runErrors.get(cm.message.runId);
      bubble.append(
        el("div", {
          class: "part-notice error",
          text: runError === undefined ? "Error" : `Error — ${runError}`,
        }),
      );
    } else if (cm.message.status === "streaming") {
      bubble.append(el("span", { class: "hint", text: "…" }));
    }
  }
  msg.append(bubble);
  const meta: string[] = [cm.message.role];
  const model = metaModel(cm)?.model;
  if (cm.message.role === "assistant" && model !== undefined && model !== "") meta.push(model);
  if (cm.message.status !== "complete") meta.push(cm.message.status);
  msg.append(el("div", { class: "meta", text: meta.join(" · ") }));
  return msg;
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
  const navToggle = el("button", { class: "nav-toggle", "aria-label": "Sessions", text: "☰" });
  const title = el("span", { class: "session-title" });
  const runHint = el("span", { class: "hint" });
  const modelPicker = el("select", { class: "model-picker" });
  const effortPicker = el("select", { class: "effort-picker" });
  const fill = el("div", { class: "fill" });
  const usageLabel = el("div", { class: "label" });
  const contextBar = el("div", { class: "context-bar" }, el("div", { class: "track" }, fill), usageLabel);
  const messages = el("div", { class: "messages" });
  const connLine = el("div", { class: "hint conn", text: "Reconnecting…" });
  const textarea = el("textarea", { placeholder: "Message…", rows: "1", enterkeyhint: "enter" });
  const send = el("button", { class: "send", text: "Send" });
  const stop = el("button", { class: "stop", text: "Stop" });
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
  let tick: ReturnType<typeof setInterval> | undefined;

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
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  });
  messages.addEventListener("scroll", () => {
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < STICK_PX;
  });
  modelPicker.addEventListener("change", () => {
    const f = families[Number(modelPicker.value)];
    if (f === undefined) return;
    const v = pickVariant(f);
    cb.onModel(f.provider, v.id);
  });
  effortPicker.addEventListener("change", () => {
    if (activeFamily === null) return;
    cb.onModel(activeFamily.provider, effortPicker.value);
  });

  const main = el(
    "div",
    { class: "main" },
    el("div", { class: "chat-header" }, navToggle, title, runHint, contextBar, modelPicker, effortPicker),
    messages,
    connLine,
    el("div", { class: "composer" }, textarea, stop, send),
  );
  root.replaceChildren(main);

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
    for (const cm of view.messages) messages.append(renderMessage(cm, ui, view));
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
    activeFamily = sel ?? null;

    clear(modelPicker);
    const groups = new Map<string, HTMLOptGroupElement>();
    const groupOrder: HTMLOptGroupElement[] = [];
    const moreGroup = el("optgroup", { label: "More variants" });
    families.forEach((f, i) => {
      const opt = el("option", { value: String(i), text: f.label });
      if (f === sel) opt.selected = true;
      if (f.more) {
        moreGroup.append(opt);
        return;
      }
      let g = groups.get(f.provider);
      if (g === undefined) {
        g = el("optgroup", { label: f.providerLabel });
        groups.set(f.provider, g);
        groupOrder.push(g);
      }
      g.append(opt);
    });
    for (const g of groupOrder) modelPicker.append(g);
    if (moreGroup.children.length > 0) modelPicker.append(moreGroup);
    modelPicker.disabled = modelPicker.children.length === 0;

    clear(effortPicker);
    if (sel === undefined || sel.variants.length <= 1) {
      effortPicker.style.display = "none";
    } else {
      effortPicker.style.display = "";
      const currentVariant =
        selected !== undefined ? sel.variants.find((v) => v.id === selected.model) : undefined;
      const shown = currentVariant ?? pickVariant(sel);
      for (const v of sel.variants) {
        const opt = el("option", { value: v.id, text: cap(v.effort) });
        if (v === shown) opt.selected = true;
        effortPicker.append(opt);
      }
    }
    effortPicker.disabled = sel === undefined;
  }

  connLine.style.display = connOpen ? "none" : "";

  return {
    update(view, providers) {
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
        families = [];
        activeFamily = null;
        clear(modelPicker);
        modelPicker.disabled = true;
        clear(effortPicker);
        effortPicker.disabled = true;
        effortPicker.style.display = "none";
        clear(messages);
        messages.append(el("div", { class: "empty", text: "Select a session" }));
        stop.style.display = "none";
        usageLabel.textContent = "";
        fill.style.width = "0%";
        syncTick(false);
        return;
      }

      title.textContent = view.session.title ?? "Untitled";
      runHint.textContent = view.runStatus ?? "";
      rebuildModels(view, providers);
      stop.style.display = view.activeRunId === null ? "none" : "";

      const ctxWindow = contextWindow(view, providers);
      if (view.contextTokens !== null) {
        const pct =
          ctxWindow !== undefined && ctxWindow > 0
            ? Math.min(100, (view.contextTokens / ctxWindow) * 100)
            : 0;
        fill.style.width = `${pct}%`;
        usageLabel.textContent =
          ctxWindow === undefined
            ? `${fmtTokens(view.contextTokens)} tok`
            : `${fmtTokens(view.contextTokens)} / ${fmtTokens(ctxWindow)} tok`;
      } else {
        fill.style.width = "0%";
        usageLabel.textContent = "";
      }

      renderMessages(view);
    },
    setConnection(open) {
      connOpen = open;
      connLine.style.display = open ? "none" : "";
    },
  };
}
