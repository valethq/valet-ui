import { el } from "../dom";
import { selectChip } from "../icons";

type Prop = Record<string, unknown>;
export type FieldKind = "boolean" | "enum" | "number" | "secret" | "text" | "list" | "json";

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
      const t = (p.items as Prop | undefined)?.type;
      return t === "string" || t === "number" || t === "integer" ? "list" : "json";
    }
    default:
      return "json";
  }
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

let seq = 0;

function control(kind: FieldKind, p: Prop, value: string | boolean, id: string): HTMLElement {
  switch (kind) {
    case "boolean": {
      const box = el("input", { type: "checkbox", class: "switch", id });
      box.checked = value === true;
      return box;
    }
    case "enum": {
      const select = el("select", { id });
      for (const v of p.enum as unknown[]) select.append(el("option", { value: String(v), text: String(v) }));
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
    const ctl = control(kind, p, formatField(kind, key === "" ? values : values[key]), id);
    const input = (ctl.tagName === "LABEL" ? ctl.querySelector("select") : ctl) as HTMLInputElement;
    const head = el("label", { class: "field-label", for: id, text: label });
    const desc =
      typeof p.description === "string" ? el("div", { class: "field-desc", text: p.description }) : null;
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
