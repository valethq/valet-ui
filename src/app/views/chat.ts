import { clear, el } from "../dom";
import { renderMarkdown } from "../markdown";
import type { SessionView } from "../state";
import type { ChatMessage, Part, ProviderModels } from "../types";

export interface ChatCallbacks {
  onSend(text: string): void;
  onStop(): void;
  onModel(provider: string, model: string): void;
}

export interface ChatHandle {
  update(view: SessionView | null, providers: ProviderModels[]): void;
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function partRow(title: string, status: string, body: string, open = false): HTMLElement {
  const details = el("details", { class: "part-row" });
  if (open) details.open = true;
  details.append(
    el("summary", {}, el("span", { text: title }), el("span", { class: `status ${status}`, text: status })),
    el("div", { class: "body" }, el("pre", { text: body })),
  );
  return details;
}

function renderPart(part: Part): HTMLElement | null {
  const d = part.data;
  switch (d.type) {
    case "text":
      return renderMarkdown(d.text);
    case "reasoning":
      return partRow("Reasoning", part.status, d.text, part.status === "streaming");
    case "tool-call": {
      const title = d.title ?? d.name;
      const body = [
        `input: ${typeof d.input === "string" ? d.input : JSON.stringify(d.input)}`,
        ...(d.output === undefined || d.output === "" ? [] : [`output: ${d.output}`]),
      ].join("\n");
      return partRow(title, d.status, body, d.status === "running" || part.status === "streaming");
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

function renderMessage(cm: ChatMessage): HTMLElement {
  const msg = el("div", { class: `msg ${cm.message.role}` });
  const bubble = el("div", { class: "bubble" });
  for (const part of cm.parts) {
    const node = renderPart(part);
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

export function createChat(root: HTMLElement, cb: ChatCallbacks): ChatHandle {
  const title = el("span", { class: "session-title" });
  const runHint = el("span", { class: "hint" });
  const modelPicker = el("select", { class: "model-picker" });
  const fill = el("div", { class: "fill" });
  const usageLabel = el("div", { class: "label" });
  const contextBar = el("div", { class: "context-bar" }, el("div", { class: "track" }, fill), usageLabel);
  const messages = el("div", { class: "messages" });
  const textarea = el("textarea", { placeholder: "Message…", rows: "1" });
  const send = el("button", { class: "send", text: "Send" });
  const stop = el("button", { class: "stop", text: "Stop" });
  stop.style.display = "none";

  let current: SessionView | null = null;

  const doSend = (): void => {
    const text = textarea.value.trim();
    if (text === "" || current === null) return;
    textarea.value = "";
    textarea.style.height = "";
    cb.onSend(text);
  };
  send.addEventListener("click", doSend);
  stop.addEventListener("click", () => cb.onStop());
  textarea.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      doSend();
    }
  });
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  });
  modelPicker.addEventListener("change", () => {
    const [provider, model] = JSON.parse(modelPicker.value) as [string, string];
    cb.onModel(provider, model);
  });

  const main = el(
    "div",
    { class: "main" },
    el("div", { class: "chat-header" }, title, runHint, contextBar, modelPicker),
    messages,
    el("div", { class: "composer" }, textarea, stop, send),
  );
  root.replaceChildren(main);

  function rebuildModels(view: SessionView, providers: ProviderModels[]): void {
    clear(modelPicker);
    const selected = view.session.settings.model;
    const seen = new Set<string>();
    for (const p of providers) {
      const group = el("optgroup", { label: p.label });
      for (const m of p.models) {
        seen.add(`${p.provider}${m.id}`);
        const opt = el("option", { value: JSON.stringify([p.provider, m.id]), text: m.name });
        if (selected?.provider === p.provider && selected.model === m.id) opt.selected = true;
        group.append(opt);
      }
      if (group.children.length > 0) modelPicker.append(group);
    }
    if (selected !== undefined && !seen.has(`${selected.provider}${selected.model}`)) {
      const opt = el("option", {
        value: JSON.stringify([selected.provider, selected.model]),
        text: `${selected.model} (${selected.provider})`,
      });
      opt.selected = true;
      modelPicker.prepend(opt);
    }
    modelPicker.disabled = modelPicker.children.length === 0;
  }

  return {
    update(view, providers) {
      current = view;
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;

      if (view === null) {
        title.textContent = "";
        clear(modelPicker);
        modelPicker.disabled = true;
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

      clear(messages);
      for (const cm of view.messages) messages.append(renderMessage(cm));
      if (view.messages.length === 0) {
        messages.append(el("div", { class: "empty", text: "No messages yet" }));
      }
      if (nearBottom) messages.scrollTop = messages.scrollHeight;
    },
  };
}
