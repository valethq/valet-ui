import { clear, el } from "../dom";
import { renderMarkdown } from "../markdown";
import { familyOf, groupModels, type ModelFamily, type ModelVariant } from "../models";
import type { SessionView } from "../state";
import type { ChatMessage, Part, ProviderModels } from "../types";

export interface ChatCallbacks {
  onSend(text: string): void;
  onStop(): void;
  onModel(provider: string, model: string): void;
  onToggleNav(): void;
}

export interface ChatHandle {
  update(view: SessionView | null, providers: ProviderModels[]): void;
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const cap = (s: string): string => (s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1));

function partRow(
  part: Part,
  title: string,
  status: string,
  body: string,
  defaultOpen: boolean,
  openState: Map<string, boolean>,
): HTMLElement {
  const details = el("details", { class: "part-row", "data-part-id": part.id });
  details.open = openState.get(part.id) ?? defaultOpen;
  const summary = el(
    "summary",
    {},
    el("span", { text: title }),
    el("span", { class: `status ${status}`, text: status }),
  );
  summary.addEventListener("click", () => openState.set(part.id, !details.open));
  details.append(summary, el("div", { class: "body" }, el("pre", { text: body })));
  return details;
}

function renderPart(part: Part, openState: Map<string, boolean>): HTMLElement | null {
  const d = part.data;
  switch (d.type) {
    case "text":
      return renderMarkdown(d.text);
    case "reasoning":
      return partRow(part, "Reasoning", part.status, d.text, part.status === "streaming", openState);
    case "tool-call": {
      const title = d.title ?? d.name;
      const body = [
        `input: ${typeof d.input === "string" ? d.input : JSON.stringify(d.input)}`,
        ...(d.output === undefined || d.output === "" ? [] : [`output: ${d.output}`]),
      ].join("\n");
      return partRow(
        part,
        title,
        d.status,
        body,
        d.status === "running" || part.status === "streaming",
        openState,
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

function renderMessage(cm: ChatMessage, openState: Map<string, boolean>): HTMLElement {
  const msg = el("div", { class: `msg ${cm.message.role}` });
  const bubble = el("div", { class: "bubble" });
  for (const part of cm.parts) {
    const node = renderPart(part, openState);
    if (node !== null) bubble.append(node);
  }
  if (cm.parts.length === 0 && cm.message.status === "streaming") {
    bubble.append(el("span", { class: "hint", text: "…" }));
  }
  msg.append(bubble);
  const status = cm.message.status === "complete" ? "" : ` · ${cm.message.status}`;
  msg.append(el("div", { class: "meta", text: `${cm.message.role}${status}` }));
  return msg;
}

function pickVariant(f: ModelFamily): ModelVariant {
  return (
    f.variants.find((v) => v.effort === "high") ??
    f.variants.find((v) => v.effort === "medium") ??
    (f.variants[0] as ModelVariant)
  );
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
  const textarea = el("textarea", { placeholder: "Message…", rows: "1", enterkeyhint: "enter" });
  const send = el("button", { class: "send", text: "Send" });
  const stop = el("button", { class: "stop", text: "Stop" });
  stop.style.display = "none";

  let current: SessionView | null = null;
  let sessionId: string | null = null;
  const openState = new Map<string, boolean>();
  let stickToBottom = true;
  let families: ModelFamily[] = [];
  let activeFamily: ModelFamily | null = null;

  const doSend = (): void => {
    const text = textarea.value.trim();
    if (text === "" || current === null) return;
    textarea.value = "";
    textarea.style.height = "";
    cb.onSend(text);
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
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
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
    el("div", { class: "composer" }, textarea, stop, send),
  );
  root.replaceChildren(main);

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

  return {
    update(view, providers) {
      current = view;
      const sid = view?.session.id ?? null;
      if (sid !== sessionId) {
        sessionId = sid;
        openState.clear();
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
        return;
      }

      title.textContent = view.session.title ?? "Untitled";
      runHint.textContent = view.runStatus ?? "";
      rebuildModels(view, providers);
      stop.style.display = view.activeRunId === null ? "none" : "";

      const ctxWindow = (() => {
        const sel = view.session.settings.model;
        if (sel === undefined) return undefined;
        return providers.find((p) => p.provider === sel.provider)?.models.find((m) => m.id === sel.model)
          ?.contextWindow;
      })();
      if (view.contextTokens !== null) {
        const pct =
          ctxWindow !== undefined && ctxWindow > 0
            ? Math.min(100, (view.contextTokens / ctxWindow) * 100)
            : 0;
        fill.style.width = `${pct}%`;
        usageLabel.textContent =
          ctxWindow === undefined
            ? `${fmtTokens(view.contextTokens)} tok`
            : `${fmtTokens(view.contextTokens)} / ${fmtTokens(ctxWindow)}`;
      } else {
        fill.style.width = "0%";
        usageLabel.textContent = "";
      }

      const scrollTops = new Map<string, number>();
      for (const row of messages.querySelectorAll<HTMLElement>(".part-row")) {
        const body = row.querySelector<HTMLElement>(".body");
        const pid = row.dataset.partId;
        if (body !== null && pid !== undefined && body.scrollTop > 0) {
          scrollTops.set(pid, body.scrollTop);
        }
      }
      clear(messages);
      for (const cm of view.messages) messages.append(renderMessage(cm, openState));
      if (view.messages.length === 0) {
        messages.append(el("div", { class: "empty", text: "No messages yet" }));
      }
      for (const row of messages.querySelectorAll<HTMLElement>(".part-row")) {
        const pid = row.dataset.partId;
        const st = pid === undefined ? undefined : scrollTops.get(pid);
        const body = row.querySelector<HTMLElement>(".body");
        if (st !== undefined && body !== null) body.scrollTop = st;
      }
      if (stickToBottom) messages.scrollTop = messages.scrollHeight;
    },
  };
}
