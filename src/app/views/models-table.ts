import { el } from "../dom";
import { iconButton } from "../icons";
import { collapse, enter } from "../motion";
import type { ModelInfo, ProviderModels } from "../types";

/** One row written to valet-agent's `models` config. */
export interface CatalogRow {
  provider: string;
  id: string;
  show?: boolean;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  efforts?: string[];
  defaultEffort?: string;
  fast?: boolean;
  custom?: boolean;
}

export type CatalogLoader = () => Promise<ProviderModels[]>;

type RowState = {
  provider: string;
  id: string;
  custom: boolean;
  show: HTMLInputElement;
  idInput: HTMLInputElement;
  name: HTMLInputElement;
  contextWindow: HTMLInputElement;
  maxOutputTokens: HTMLInputElement;
  efforts: HTMLInputElement;
  fast: HTMLInputElement;
  node: HTMLElement;
};

const numOrEmpty = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1)
    throw new Error("limits must be whole numbers ≥ 1");
  return n;
};

const effortsOf = (s: string): string[] | undefined => {
  const items = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  return items.length === 0 ? undefined : items;
};

function rowFromModel(provider: string, m: ModelInfo): CatalogRow {
  return {
    provider,
    id: m.id,
    show: m.show !== false,
    name: m.name,
    ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
    ...(typeof m.maxOutputTokens === "number" ? { maxOutputTokens: m.maxOutputTokens } : {}),
    ...(m.efforts !== undefined ? { efforts: m.efforts } : {}),
    ...(m.defaultEffort !== undefined ? { defaultEffort: m.defaultEffort } : {}),
    ...(typeof m.fast === "boolean" ? { fast: m.fast } : {}),
    ...(m.custom === true ? { custom: true } : {}),
  };
}

/** Merge provider listings with saved `values.models` rows (custom-only extras). */
export function mergeModelRows(providers: ProviderModels[], saved: unknown): CatalogRow[] {
  const savedRows = Array.isArray(saved)
    ? saved.filter((r): r is CatalogRow => typeof r === "object" && r !== null && !Array.isArray(r))
    : [];
  const listed = new Set<string>();
  const out: CatalogRow[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      if (m.id === "") continue;
      listed.add(`${p.provider}\0${m.id}`);
      out.push(rowFromModel(p.provider, m));
    }
  }
  for (const r of savedRows) {
    if (r.custom !== true || typeof r.provider !== "string" || typeof r.id !== "string") continue;
    if (listed.has(`${r.provider}\0${r.id}`)) continue;
    out.push({ ...r, custom: true, show: r.show !== false });
  }
  return out;
}

/** Editable catalog table for x-widget "models". */
export function modelsTable(
  value: unknown,
  load: CatalogLoader,
): { node: HTMLElement; read(): CatalogRow[]; ready: Promise<void> } {
  const node = el("div", { class: "models-table" });
  const head = el(
    "div",
    { class: "models-head" },
    el("span", { text: "Show" }),
    el("span", { text: "Provider" }),
    el("span", { text: "Id" }),
    el("span", { text: "Name" }),
    el("span", { text: "Context" }),
    el("span", { text: "Max out" }),
    el("span", { text: "Efforts" }),
    el("span", { text: "Fast" }),
    el("span", { text: "" }),
  );
  const body = el("div", { class: "models-body" });
  const status = el("div", { class: "hint", text: "Loading models…" });
  const rows: RowState[] = [];

  const add = (row: CatalogRow) => {
    const custom = row.custom === true;
    const show = el("input", { type: "checkbox", class: "switch", "aria-label": "In the picker" });
    show.checked = row.show !== false;
    const idInput = el("input", {
      class: "input mono",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Model id",
      ...(custom ? {} : { readOnly: "true" }),
    });
    idInput.value = row.id;
    const name = el("input", {
      class: "input",
      type: "text",
      autocomplete: "off",
      "aria-label": "Name",
    });
    name.value = row.name ?? "";
    const contextWindow = el("input", {
      class: "input",
      type: "number",
      autocomplete: "off",
      "aria-label": "Context window",
    });
    contextWindow.value = row.contextWindow === undefined ? "" : String(row.contextWindow);
    const maxOutputTokens = el("input", {
      class: "input",
      type: "number",
      autocomplete: "off",
      "aria-label": "Max output",
    });
    maxOutputTokens.value = row.maxOutputTokens === undefined ? "" : String(row.maxOutputTokens);
    const efforts = el("input", {
      class: "input",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "low, medium, high",
      "aria-label": "Efforts",
    });
    efforts.value = (row.efforts ?? []).join(", ");
    const fast = el("input", { type: "checkbox", class: "switch", "aria-label": "Fast mode" });
    fast.checked = row.fast === true;
    const providerLabel = el("span", { class: "models-provider mono", text: row.provider });
    const remove = iconButton("trash", "Remove custom model");
    remove.type = "button";
    remove.hidden = !custom;
    const line = el(
      "div",
      { class: `models-row${custom ? " custom" : ""}` },
      show,
      providerLabel,
      idInput,
      name,
      contextWindow,
      maxOutputTokens,
      efforts,
      fast,
      remove,
    );
    const state: RowState = {
      provider: row.provider,
      id: row.id,
      custom,
      show,
      idInput,
      name,
      contextWindow,
      maxOutputTokens,
      efforts,
      fast,
      node: line,
    };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(state);
      if (i < 0) return;
      rows.splice(i, 1);
      collapse(line);
    });
    rows.push(state);
    body.append(line);
  };

  const providerSelect = el("select", { "aria-label": "Provider for custom model" });
  const addBtn = el("button", { type: "button", class: "chip", text: "Add custom" });
  const footer = el("div", { class: "models-add" }, selectChip(providerSelect), addBtn);

  addBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    if (provider === "") return;
    add({
      provider,
      id: "",
      name: "",
      show: true,
      custom: true,
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
    });
    const last = rows[rows.length - 1];
    if (last !== undefined) enter(last.node);
    last?.idInput.focus();
  });

  node.append(status, head, body, footer);

  const ready = load()
    .then((list) => {
      providerSelect.replaceChildren();
      for (const p of list) {
        providerSelect.append(el("option", { value: p.provider, text: p.label || p.provider }));
      }
      footer.hidden = list.length === 0;
      status.remove();
      for (const row of mergeModelRows(list, value)) add(row);
      if (rows.length === 0) {
        node.insertBefore(el("div", { class: "hint", text: "No models listed yet." }), head);
      }
    })
    .catch((e: unknown) => {
      status.className = "hint error";
      status.textContent = e instanceof Error ? e.message : String(e);
      footer.hidden = true;
    });

  return {
    node,
    ready,
    read(): CatalogRow[] {
      return rows.map((r) => {
        const id = r.custom ? r.idInput.value.trim() : r.id;
        if (id === "") throw new Error("Custom model id is required");
        const contextWindow = numOrEmpty(r.contextWindow.value);
        const maxOutputTokens = numOrEmpty(r.maxOutputTokens.value);
        const efforts = effortsOf(r.efforts.value);
        const name = r.name.value.trim();
        const out: CatalogRow = {
          provider: r.provider,
          id,
          show: r.show.checked,
          ...(name === "" ? {} : { name }),
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          ...(efforts === undefined ? {} : { efforts }),
          ...(r.fast.checked ? { fast: true } : r.custom ? { fast: false } : {}),
          ...(r.custom ? { custom: true } : {}),
        };
        // Non-custom: always persist show + overrides so the catalog round-trips.
        if (!r.custom && !r.fast.checked) {
          // omit fast when false for listed models (default)
        }
        return out;
      });
    },
  };
}

function selectChip(select: HTMLSelectElement): HTMLElement {
  const wrap = el("label", { class: "chip field-select" });
  wrap.append(select);
  return wrap;
}
