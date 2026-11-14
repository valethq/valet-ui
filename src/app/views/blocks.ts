import { el } from "../dom";

export type Tone = "normal" | "good" | "warning" | "critical";

/** The fields the UI reads from a plugin's settings block (mirrors SettingsBlock in @valethq/sdk). */
export type Block =
  | { type: "text"; text: string; tone: Tone }
  | { type: "badge"; text: string; tone: Tone }
  | { type: "stat"; label: string; value: string; caption?: string }
  | {
      type: "meter";
      label: string;
      value: number;
      display?: string;
      caption?: string;
      status?: string;
      marker?: number;
      tone: Tone;
    }
  | { type: "table"; columns: string[]; rows: string[][] }
  | {
      type: "button";
      label: string;
      action: string;
      args: Record<string, unknown>;
      confirm?: string;
      tone: Tone;
    }
  | { type: "group"; title?: string; layout: "stack" | "row"; blocks: Block[] }
  | { type: "unknown"; json: string };

const MAX_DEPTH = 4;
const MIN_REFRESH_MS = 1000;
const TONES: readonly string[] = ["normal", "good", "warning", "critical"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
const tone = (v: unknown): Tone => (typeof v === "string" && TONES.includes(v) ? (v as Tone) : "normal");

export function clampPercent(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : undefined;
}

/** How often to re-fetch a panel, or undefined for "never". Plugins ask; the UI never polls faster than 1s. */
export function refreshInterval(ms: unknown): number | undefined {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.max(MIN_REFRESH_MS, ms) : undefined;
}

const unknown = (raw: unknown): Block => ({
  type: "unknown",
  json: JSON.stringify(raw, null, 2) ?? "undefined",
});

/** Wire data is untrusted: anything malformed or newer than this UI becomes a JSON fallback block. */
export function cleanBlock(raw: unknown, depth = 0): Block {
  if (!isObject(raw) || depth > MAX_DEPTH) return unknown(raw);
  const caption = str(raw.caption);
  switch (raw.type) {
    case "text":
    case "badge": {
      const text = str(raw.text);
      return text === undefined ? unknown(raw) : { type: raw.type, text, tone: tone(raw.tone) };
    }
    case "stat": {
      const label = str(raw.label);
      const value = str(raw.value);
      return label === undefined || value === undefined
        ? unknown(raw)
        : { type: "stat", label, value, ...(caption !== undefined && { caption }) };
    }
    case "meter": {
      const label = str(raw.label);
      const value = clampPercent(raw.value);
      if (label === undefined || value === undefined) return unknown(raw);
      const display = str(raw.display);
      const status = str(raw.status);
      const marker = clampPercent(raw.marker);
      return {
        type: "meter",
        label,
        value,
        ...(display !== undefined && { display }),
        ...(caption !== undefined && { caption }),
        ...(status !== undefined && { status }),
        ...(marker !== undefined && { marker }),
        tone: tone(raw.tone),
      };
    }
    case "table": {
      if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return unknown(raw);
      return {
        type: "table",
        columns: raw.columns.map((c) => str(c) ?? ""),
        rows: raw.rows.map((r) => (Array.isArray(r) ? r.map((c) => str(c) ?? "") : [])),
      };
    }
    case "button": {
      const label = str(raw.label);
      const action = str(raw.action);
      if (label === undefined || action === undefined) return unknown(raw);
      const confirm = str(raw.confirm);
      return {
        type: "button",
        label,
        action,
        args: isObject(raw.args) ? raw.args : {},
        ...(confirm !== undefined && { confirm }),
        tone: tone(raw.tone),
      };
    }
    case "group": {
      if (!Array.isArray(raw.blocks)) return unknown(raw);
      const title = str(raw.title);
      return {
        type: "group",
        ...(title !== undefined && { title }),
        layout: raw.layout === "row" ? "row" : "stack",
        blocks: raw.blocks.map((b) => cleanBlock(b, depth + 1)),
      };
    }
    default:
      return unknown(raw);
  }
}

export interface BlockDeps {
  /** Runs a button's action. Reject to show the message beside the button. */
  run(action: string, args: Record<string, unknown>): Promise<void>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function meterNode(b: Extract<Block, { type: "meter" }>): HTMLElement {
  const fill = el("div", { class: "meter-fill" });
  fill.style.width = `${b.value}%`;
  const bar = el("div", {
    class: "meter-bar",
    role: "meter",
    "aria-label": b.label,
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": String(Math.round(b.value)),
    ...(b.display !== undefined && { "aria-valuetext": b.display }),
  });
  bar.append(fill);
  if (b.marker !== undefined) {
    const marker = el("div", { class: "meter-marker" });
    marker.style.left = `${b.marker}%`;
    bar.append(marker);
  }
  return el(
    "div",
    { class: `blk-meter tone-${b.tone}` },
    el(
      "div",
      { class: "meter-head" },
      el("span", { class: "meter-label", text: b.label }),
      ...(b.status === undefined ? [] : [el("span", { class: "meter-status", text: b.status })]),
    ),
    ...(b.display === undefined ? [] : [el("div", { class: "meter-display", text: b.display })]),
    ...(b.caption === undefined ? [] : [el("div", { class: "meter-caption", text: b.caption })]),
    bar,
  );
}

function tableNode(b: Extract<Block, { type: "table" }>): HTMLElement {
  const head = el("tr", {}, ...b.columns.map((c) => el("th", { text: c })));
  const rows = b.rows.map((r) => el("tr", {}, ...r.map((c) => el("td", { text: c }))));
  return el("table", { class: "blk-table" }, el("thead", {}, head), el("tbody", {}, ...rows));
}

function buttonNode(b: Extract<Block, { type: "button" }>, deps: BlockDeps): HTMLElement {
  const button = el("button", { class: `blk-button tone-${b.tone}`, type: "button", text: b.label });
  const error = el("span", { class: "blk-error" });
  button.addEventListener("click", () => {
    if (b.confirm !== undefined && !window.confirm(b.confirm)) return;
    error.textContent = "";
    button.disabled = true;
    deps
      .run(b.action, b.args)
      .catch((e: unknown) => {
        error.textContent = errorText(e);
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return el("span", { class: "blk-action" }, button, error);
}

export function blockNode(b: Block, deps: BlockDeps): HTMLElement {
  switch (b.type) {
    case "text":
      return el("p", { class: `blk-text tone-${b.tone}`, text: b.text });
    case "badge":
      return el("span", { class: `blk-badge tone-${b.tone}`, text: b.text });
    case "stat":
      return el(
        "div",
        { class: "blk-stat" },
        el("div", { class: "stat-label", text: b.label }),
        el("div", { class: "stat-value", text: b.value }),
        ...(b.caption === undefined ? [] : [el("div", { class: "stat-caption", text: b.caption })]),
      );
    case "meter":
      return meterNode(b);
    case "table":
      return tableNode(b);
    case "button":
      return buttonNode(b, deps);
    case "group":
      return el(
        "div",
        { class: `blk-group ${b.layout}` },
        ...(b.title === undefined ? [] : [el("h4", { text: b.title })]),
        ...b.blocks.map((c) => blockNode(c, deps)),
      );
    case "unknown":
      return el("pre", { class: "blk-unknown", text: b.json });
  }
}

export function renderBlocks(raw: unknown[], deps: BlockDeps): HTMLElement[] {
  return raw.map((r) => blockNode(cleanBlock(r), deps));
}
