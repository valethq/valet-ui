import { el } from "../dom";
import { iconButton, selectChip } from "../icons";
import { collapse, enter } from "../motion";
import type { ProviderModels, SecretMeta } from "../types";
import { modelsTable, type CatalogLoader } from "./models-table";

type Prop = Record<string, unknown>;
export type FieldKind =
  | "boolean"
  | "enum"
  | "segmented"
  | "number"
  | "secret"
  | "secretName"
  | "text"
  | "textarea"
  | "list"
  | "rows"
  | "model"
  | "models"
  | "json";

export interface SchemaFormDeps {
  listModels?: () => Promise<ProviderModels[]>;
  listCatalog?: CatalogLoader;
  getSecretMeta?: (name: string) => Promise<SecretMeta>;
  putSecret?: (name: string, value: string) => Promise<SecretMeta>;
}

/** Maps a JSON-schema property to the control that edits it; anything
 * outside the simple subset falls back to a JSON textarea. */
export function fieldKind(p: Prop): FieldKind {
  const widget = typeof p["x-widget"] === "string" ? p["x-widget"] : undefined;
  if (widget === "textarea") return "textarea";
  if (widget === "secret") return "secretName";
  if (widget === "model") return "model";
  if (widget === "models") return "models";
  if (widget === "segmented" && Array.isArray(p.enum)) return "segmented";
  if (Array.isArray(p.enum)) return "enum";
  switch (p.type) {
    case "boolean":
      return "boolean";
    case "number":
    case "integer":
      return "number";
    case "string":
      return p.format === "password" || p.writeOnly === true ? "secret" : "text";
    case "array": {
      const items = p.items as Prop | undefined;
      const t = items?.type;
      if (t === "string" || t === "number" || t === "integer") return "list";
      return rowColumns(items) ? "rows" : "json";
    }
    default:
      return "json";
  }
}

type Column = { key: string; prop: Prop; label: string };

/** Columns of an array-of-objects schema whose properties are all plain strings or numbers; otherwise undefined. */
export function rowColumns(items: Prop | undefined): Column[] | undefined {
  if (items?.type !== "object") return undefined;
  const entries = Object.entries((items.properties ?? {}) as Record<string, Prop>);
  const simple = entries.every(([, q]) => {
    const k = fieldKind(q);
    return k === "text" || k === "number" || k === "boolean";
  });
  if (entries.length === 0 || !simple) return undefined;
  return entries.map(([key, prop]) => ({
    key,
    prop,
    label: typeof prop.title === "string" ? prop.title : key,
  }));
}

/** One row -> object. Blank fields are left out; a blank required field is an error. */
export function parseRow(
  cols: Column[],
  raw: (string | boolean)[],
  required: unknown,
  label: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    const kind = fieldKind(c.prop);
    const cell = raw[i];
    const v =
      kind === "boolean"
        ? cell === true
        : parseField(
            kind,
            typeof cell === "boolean" ? String(cell) : (cell ?? ""),
            c.prop,
            `${label} ${c.label}`,
          );
    const blank = v === undefined || v === "";
    if (blank && Array.isArray(required) && required.includes(c.key))
      throw new Error(`${label}: ${c.label} is required`);
    if (!blank) out[c.key] = v;
  });
  return out;
}

export function formatField(kind: FieldKind, value: unknown): string | boolean {
  if (kind === "boolean") return value === true;
  if (kind === "secret" || value === undefined || value === null) return "";
  if (kind === "list") return Array.isArray(value) ? value.join("\n") : "";
  if (kind === "json" || kind === "model") return JSON.stringify(value ?? {}, null, 2);
  if (kind === "models") return "";
  return String(value);
}

const toNumber = (s: string, integer: boolean, label: string): number => {
  const n = Number(s);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    throw new Error(`${label} must be ${integer ? "a whole number" : "a number"}`);
  }
  return n;
};

/** Control value -> typed value. `undefined` leaves the key unset (an empty
 * number, or an untouched secret so a redacted value is never written back). */
export function parseField(kind: FieldKind, raw: string | boolean, p: Prop, label: string): unknown {
  if (kind === "boolean") return raw === true;
  const s = String(raw);
  switch (kind) {
    case "number":
      return s.trim() === "" ? undefined : toNumber(s, p.type === "integer", label);
    case "secret":
      return s === "" ? undefined : s;
    case "secretName":
    case "text":
    case "textarea":
      return s;
    case "enum":
    case "segmented":
      return (p.enum as unknown[]).find((v) => String(v) === s);
    case "list": {
      const items = s
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      const t = (p.items as Prop).type;
      return t === "string" ? items : items.map((x) => toNumber(x, t === "integer", label));
    }
    case "json":
    case "model":
      if (s.trim() === "") return undefined;
      try {
        return JSON.parse(s);
      } catch {
        throw new Error(`${label} is not valid JSON`);
      }
    default:
      return s;
  }
}

/** Option labels for an enum: `enumNames[i]` names `enum[i]` (a common JSON-schema
 * convention). Missing or non-string entries fall back to the raw value. */
export function enumLabels(p: Prop): string[] {
  const names = Array.isArray(p.enumNames) ? p.enumNames : [];
  return (p.enum as unknown[]).map((v, i) => (typeof names[i] === "string" ? names[i] : String(v)));
}

let seq = 0;

/** An editable list of objects: one line of inputs per entry, a remove button each, and an add button. */
function rowsEditor(p: Prop, cols: Column[], value: unknown, label: string) {
  const node = el("div", { class: "rows" });
  const list = el("div", { class: "rows-list" });
  type RowItem = {
    inputs: (HTMLInputElement | HTMLInputElement)[];
    checks: Map<number, HTMLInputElement>;
    extra: Record<string, unknown>;
    node: HTMLElement;
  };
  const rows: RowItem[] = [];
  const keys = new Set(cols.map((c) => c.key));
  const add = (entry: Record<string, unknown> = {}) => {
    const checks = new Map<number, HTMLInputElement>();
    const inputs = cols.map((c, i) => {
      const kind = fieldKind(c.prop);
      if (kind === "boolean") {
        const box = el("input", {
          type: "checkbox",
          class: "switch",
          "aria-label": c.label,
        });
        box.checked = entry[c.key] === true;
        checks.set(i, box);
        return box;
      }
      const input = el("input", {
        class: "input",
        type: kind === "number" ? "number" : "text",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: c.label,
        "aria-label": c.label,
        ...(c.prop.readOnly === true ? { readOnly: "true" } : {}),
      });
      input.value = String(entry[c.key] ?? "");
      return input;
    });
    const extra = Object.fromEntries(Object.entries(entry).filter(([k]) => !keys.has(k)));
    const remove = iconButton("trash", `Remove ${label}`);
    remove.type = "button";
    const row = el("div", { class: "rows-row" }, ...inputs, remove);
    const item: RowItem = { inputs, checks, extra, node: row };
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(item), 1);
      collapse(row);
    });
    rows.push(item);
    list.append(row);
  };
  for (const e of Array.isArray(value) ? value : []) {
    if (typeof e === "object" && e !== null && !Array.isArray(e)) add(e as Record<string, unknown>);
  }
  const addBtn = el("button", { type: "button", class: "chip", text: "Add" });
  addBtn.addEventListener("click", () => {
    add();
    const last = rows[rows.length - 1];
    if (last !== undefined) enter(last.node);
    last?.inputs[0]?.focus();
  });
  node.append(list, el("div", { class: "rows-add" }, addBtn));
  return {
    node,
    read: () =>
      rows
        .map((r) => ({
          ...r.extra,
          ...parseRow(
            cols,
            r.inputs.map((input, i) => {
              const box = r.checks.get(i);
              return box !== undefined ? box.checked : input.value;
            }),
            (p.items as Prop).required,
            label,
          ),
        }))
        .filter((o) => Object.keys(o).length > 0),
  };
}

function segmentedControl(p: Prop, value: unknown, id: string): { node: HTMLElement; read(): unknown } {
  const values = p.enum as unknown[];
  const labels = enumLabels(p);
  let current = values.find((v) => String(v) === String(value)) ?? values[0];
  const node = el("div", {
    class: "segmented",
    role: "radiogroup",
    id,
    "aria-label": typeof p.title === "string" ? p.title : "Options",
  });
  const buttons = labels.map((text, i) => {
    const b = el("button", { type: "button", text });
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => {
      current = values[i];
      for (const [j, btn] of buttons.entries()) btn.setAttribute("aria-checked", String(j === i));
    });
    node.append(b);
    return b;
  });
  const idx = Math.max(0, values.indexOf(current));
  for (const [i, b] of buttons.entries()) b.setAttribute("aria-checked", String(i === idx));
  return { node, read: () => current };
}

function secretNameControl(
  _p: Prop,
  value: unknown,
  id: string,
  deps: SchemaFormDeps,
): { node: HTMLElement; read(): string } {
  const name = el("input", {
    id,
    class: "input mono",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "secret_name",
  });
  name.value = typeof value === "string" ? value : "";
  const meta = el("span", { class: "secret-meta hint", text: "" });
  const valueInput = el("input", {
    class: "input",
    type: "password",
    autocomplete: "new-password",
    placeholder: "New value",
    hidden: "true",
  });
  const setBtn = el("button", { type: "button", class: "chip", text: "Set value…" });
  const saveBtn = el("button", { type: "button", class: "chip", text: "Save secret", hidden: "true" });
  const row = el("div", { class: "secret-row" }, name, setBtn, saveBtn);
  const node = el("div", { class: "secret-name" }, row, valueInput, meta);

  const refreshMeta = (): void => {
    const n = name.value.trim();
    if (n === "" || deps.getSecretMeta === undefined) {
      meta.textContent = "";
      return;
    }
    deps
      .getSecretMeta(n)
      .then((m) => {
        meta.textContent =
          m.source === "file"
            ? "Stored as a file"
            : m.source === "env"
              ? "Set in the environment"
              : "Not set";
      })
      .catch(() => {
        meta.textContent = "";
      });
  };
  name.addEventListener("change", refreshMeta);
  name.addEventListener("blur", refreshMeta);
  refreshMeta();

  setBtn.addEventListener("click", () => {
    valueInput.hidden = false;
    saveBtn.hidden = false;
    setBtn.hidden = true;
    valueInput.focus();
  });
  saveBtn.addEventListener("click", () => {
    const n = name.value.trim();
    const v = valueInput.value;
    if (n === "" || v === "" || deps.putSecret === undefined) return;
    saveBtn.disabled = true;
    deps
      .putSecret(n, v)
      .then(() => {
        valueInput.value = "";
        valueInput.hidden = true;
        saveBtn.hidden = true;
        setBtn.hidden = false;
        meta.textContent = "Stored as a file";
      })
      .catch((e: unknown) => {
        meta.className = "secret-meta hint error";
        meta.textContent = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        saveBtn.disabled = false;
      });
  });

  return { node, read: () => name.value };
}

function modelControl(
  value: unknown,
  id: string,
  deps: SchemaFormDeps,
): { node: HTMLElement; read(): Record<string, unknown> } {
  const current =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const provider = el("select", { id, "aria-label": "Provider" });
  const model = el("select", { "aria-label": "Model" });
  const effort = el("select", { "aria-label": "Effort" });
  const fast = el("input", { type: "checkbox", class: "switch", "aria-label": "Fast" });
  fast.checked = current.fast === true;
  const node = el(
    "div",
    { class: "model-ref" },
    selectChip(provider, "field-select"),
    selectChip(model, "field-select"),
    selectChip(effort, "field-select"),
    el("label", { class: "model-fast" }, fast, el("span", { text: "Fast" })),
  );
  let catalog: ProviderModels[] = [];

  const fillModels = (): void => {
    const p = catalog.find((x) => x.provider === provider.value);
    const models = p?.models ?? [];
    model.replaceChildren();
    for (const m of models) model.append(el("option", { value: m.id, text: m.name || m.id }));
    if (typeof current.model === "string" && models.some((m) => m.id === current.model))
      model.value = current.model;
    fillEfforts();
  };
  const fillEfforts = (): void => {
    const p = catalog.find((x) => x.provider === provider.value);
    const m = p?.models.find((x) => x.id === model.value);
    const efforts = m?.efforts ?? [];
    effort.replaceChildren(el("option", { value: "", text: "Default" }));
    for (const e of efforts) effort.append(el("option", { value: e, text: e }));
    effort.hidden = efforts.length === 0;
    if (typeof current.effort === "string" && efforts.includes(current.effort)) effort.value = current.effort;
    else effort.value = "";
    fast.hidden = m?.fast !== true;
    if (m?.fast !== true) fast.checked = false;
  };

  provider.addEventListener("change", fillModels);
  model.addEventListener("change", fillEfforts);

  void (deps.listModels?.() ?? Promise.resolve([])).then((list) => {
    catalog = list;
    provider.replaceChildren();
    for (const p of list) provider.append(el("option", { value: p.provider, text: p.label || p.provider }));
    if (typeof current.provider === "string" && list.some((p) => p.provider === current.provider))
      provider.value = current.provider;
    else if (list[0] !== undefined) provider.value = list[0].provider;
    fillModels();
  });

  return {
    node,
    read: () => {
      const out: Record<string, unknown> = {
        provider: provider.value,
        model: model.value,
      };
      if (effort.value !== "" && !effort.hidden) out.effort = effort.value;
      if (!fast.hidden) out.fast = fast.checked;
      if (Array.isArray(current.fallbacks)) out.fallbacks = current.fallbacks;
      return out;
    },
  };
}

function control(kind: FieldKind, p: Prop, value: string | boolean, id: string): HTMLElement {
  switch (kind) {
    case "boolean": {
      const box = el("input", { type: "checkbox", class: "switch", id });
      box.checked = value === true;
      return box;
    }
    case "enum": {
      const select = el("select", { id });
      enumLabels(p).forEach((text, i) => {
        select.append(el("option", { value: String((p.enum as unknown[])[i]), text }));
      });
      select.value = String(value);
      return selectChip(select, "field-select");
    }
    case "list":
    case "json":
    case "textarea": {
      const ta = el("textarea", {
        id,
        class: `input${kind === "json" ? " mono" : ""}`,
        rows: kind === "json" ? "5" : "3",
        spellcheck: "false",
        ...(kind === "list" && { placeholder: "One per line" }),
      });
      ta.value = String(value);
      return ta;
    }
    default: {
      const input = el("input", {
        id,
        class: "input",
        type: kind === "number" ? "number" : kind === "secret" ? "password" : "text",
        autocomplete: "off",
        ...(kind === "secret" && { placeholder: "Unchanged" }),
      });
      input.value = String(value);
      return input;
    }
  }
}

type FieldSlot = {
  key: string;
  prop: Prop;
  kind: FieldKind;
  advanced: boolean;
  section?: string;
};

function fieldSlots(props: [string, Prop][]): FieldSlot[] {
  return props.map(([key, prop]) => ({
    key,
    prop,
    kind: fieldKind(prop),
    advanced: prop["x-advanced"] === true,
    ...(typeof prop["x-section"] === "string" ? { section: prop["x-section"] } : {}),
  }));
}

/** Renders `schema.properties` as a form; `read()` merges edits over the
 * original values (unknown keys survive) and throws on invalid input. */
export function schemaForm(
  schema: Prop,
  values: Record<string, unknown>,
  deps: SchemaFormDeps = {},
): { node: HTMLElement; read(): Record<string, unknown> } {
  const node = el("div", { class: "form" });
  const props = Object.entries((schema.properties ?? {}) as Record<string, Prop>);
  if (props.length === 0) props.push(["", { type: "object", title: "Values" }]);
  const readers: (() => [string, unknown])[] = [];
  const slots = fieldSlots(props);

  const mountField = (parent: HTMLElement, slot: FieldSlot): void => {
    const { key, prop: p, kind } = slot;
    const label = typeof p.title === "string" ? p.title : key;
    const id = `sf-${++seq}`;
    const head = el("label", { class: "field-label", for: id, text: label });
    const desc =
      typeof p.description === "string" ? el("div", { class: "field-desc", text: p.description }) : null;

    if (kind === "rows") {
      const cols = rowColumns(p.items as Prop) as Column[];
      const rows = rowsEditor(p, cols, values[key], label);
      parent.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), rows.node));
      readers.push(() => [key, rows.read()]);
      return;
    }
    if (kind === "segmented") {
      const seg = segmentedControl(p, values[key], id);
      parent.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), seg.node));
      readers.push(() => [key, seg.read()]);
      return;
    }
    if (kind === "secretName") {
      const ctl = secretNameControl(p, values[key], id, deps);
      parent.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), ctl.node));
      readers.push(() => [key, ctl.read()]);
      return;
    }
    if (kind === "model") {
      const ctl = modelControl(values[key], id, deps);
      parent.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), ctl.node));
      readers.push(() => [key, ctl.read()]);
      return;
    }
    if (kind === "models") {
      const load = deps.listCatalog ?? deps.listModels ?? (() => Promise.resolve([]));
      const table = modelsTable(values[key], load);
      parent.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), table.node));
      readers.push(() => [key, table.read()]);
      return;
    }

    const ctl = control(kind, p, formatField(kind, key === "" ? values : values[key]), id);
    const input = (ctl.tagName === "LABEL" ? ctl.querySelector("select") : ctl) as HTMLInputElement;
    parent.append(
      kind === "boolean"
        ? el("div", { class: "field toggle" }, el("div", {}, head, ...(desc ? [desc] : [])), ctl)
        : el("div", { class: "field" }, head, ...(desc ? [desc] : []), ctl),
    );
    readers.push(() => [key, parseField(kind, kind === "boolean" ? input.checked : input.value, p, label)]);
  };

  const normal = slots.filter((s) => !s.advanced);
  const advanced = slots.filter((s) => s.advanced);

  const appendGrouped = (parent: HTMLElement, list: FieldSlot[]): void => {
    let currentSection: string | undefined;
    let sectionNode: HTMLElement | undefined;
    for (const slot of list) {
      if (slot.section !== undefined && slot.section !== currentSection) {
        currentSection = slot.section;
        sectionNode = el(
          "div",
          { class: "form-section" },
          el("h4", { class: "form-section-title", text: currentSection }),
        );
        parent.append(sectionNode);
      }
      mountField(sectionNode ?? parent, slot);
    }
  };

  appendGrouped(node, normal);
  if (advanced.length > 0) {
    const details = el("details", { class: "form-advanced" });
    details.append(el("summary", { text: "Advanced" }));
    const body = el("div", { class: "form-advanced-body" });
    appendGrouped(body, advanced);
    details.append(body);
    node.append(details);
  }

  return {
    node,
    read() {
      const out: Record<string, unknown> = { ...values };
      for (const r of readers) {
        const [k, v] = r();
        if (k === "") {
          if (typeof v !== "object" || v === null || Array.isArray(v))
            throw new Error("Values must be an object");
          return v as Record<string, unknown>;
        }
        if (v === undefined) delete out[k];
        else out[k] = v;
      }
      return out;
    },
  };
}
