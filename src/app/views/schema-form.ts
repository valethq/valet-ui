import { el } from "../dom";
import { iconButton, selectChip } from "../icons";

type Prop = Record<string, unknown>;
export type FieldKind = "boolean" | "enum" | "number" | "secret" | "text" | "list" | "rows" | "json";

/** Maps a JSON-schema property to the control that edits it; anything
 * outside the simple subset falls back to a JSON textarea. */
export function fieldKind(p: Prop): FieldKind {
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
    return k === "text" || k === "number";
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
  raw: string[],
  required: unknown,
  label: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    const kind = fieldKind(c.prop);
    const v = parseField(kind, raw[i] ?? "", c.prop, `${label} ${c.label}`);
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
  if (kind === "json") return JSON.stringify(value, null, 2);
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
    case "enum":
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
  const rows: { inputs: HTMLInputElement[]; extra: Record<string, unknown>; node: HTMLElement }[] = [];
  const keys = new Set(cols.map((c) => c.key));
  const add = (entry: Record<string, unknown> = {}) => {
    const inputs = cols.map((c) => {
      const kind = fieldKind(c.prop);
      const input = el("input", {
        class: "input",
        type: kind === "number" ? "number" : "text",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: c.label,
        "aria-label": c.label,
      });
      input.value = String(entry[c.key] ?? "");
      return input;
    });
    const extra = Object.fromEntries(Object.entries(entry).filter(([k]) => !keys.has(k)));
    const remove = iconButton("trash", `Remove ${label}`);
    remove.type = "button";
    const row = el("div", { class: "rows-row" }, ...inputs, remove);
    const item = { inputs, extra, node: row };
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(item), 1);
      row.remove();
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
    rows[rows.length - 1]?.inputs[0]?.focus();
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
            r.inputs.map((i) => i.value),
            (p.items as Prop).required,
            label,
          ),
        }))
        .filter((o) => Object.keys(o).length > 0),
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
    case "json": {
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

/** Renders `schema.properties` as a form; `read()` merges edits over the
 * original values (unknown keys survive) and throws on invalid input. */
export function schemaForm(
  schema: Prop,
  values: Record<string, unknown>,
): { node: HTMLElement; read(): Record<string, unknown> } {
  const node = el("div", { class: "form" });
  const props = Object.entries((schema.properties ?? {}) as Record<string, Prop>);
  if (props.length === 0) props.push(["", { type: "object", title: "Values" }]);
  const readers: (() => [string, unknown])[] = [];
  for (const [key, p] of props) {
    const kind = fieldKind(p);
    const label = typeof p.title === "string" ? p.title : key;
    const id = `sf-${++seq}`;
    const head = el("label", { class: "field-label", for: id, text: label });
    const desc =
      typeof p.description === "string" ? el("div", { class: "field-desc", text: p.description }) : null;
    if (kind === "rows") {
      const cols = rowColumns(p.items as Prop) as Column[];
      const rows = rowsEditor(p, cols, values[key], label);
      node.append(el("div", { class: "field" }, head, ...(desc ? [desc] : []), rows.node));
      readers.push(() => [key, rows.read()]);
      continue;
    }
    const ctl = control(kind, p, formatField(kind, key === "" ? values : values[key]), id);
    const input = (ctl.tagName === "LABEL" ? ctl.querySelector("select") : ctl) as HTMLInputElement;
    node.append(
      kind === "boolean"
        ? el("div", { class: "field toggle" }, el("div", {}, head, ...(desc ? [desc] : [])), ctl)
        : el("div", { class: "field" }, head, ...(desc ? [desc] : []), ctl),
    );
    readers.push(() => [key, parseField(kind, kind === "boolean" ? input.checked : input.value, p, label)]);
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
