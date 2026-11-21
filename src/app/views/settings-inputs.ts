import { el } from "../dom";
import { iconButton, selectChip } from "../icons";
import { collapse, enter } from "../motion";
import {
  evalCond,
  pasteName,
  renderAs,
  resolveArgs,
  secretNameOf,
  staticOptions,
  unitHint,
} from "../settings-model";
import type { Args, CorePluginSettings, DisplayDef, InputDef, OptionDef, SecretMeta } from "../types";

/** What a control needs from its form. */
export interface InputEnv {
  types: CorePluginSettings["types"];
  /** Current values of the whole form (for conditions and `{ $: path }` args). */
  root(): Record<string, unknown>;
  options(from: string, args: Args): Promise<OptionDef[]>;
  listSecrets(): Promise<SecretMeta[]>;
  putSecret(name: string, value: string): Promise<SecretMeta>;
  display(def: DisplayDef, item?: unknown): HTMLElement;
  /** A value changed: the form re-evaluates conditions and dependent options. */
  changed(): void;
  /** Plugin id, for Paste's default secret name. */
  plugin: string;
}

export interface Control {
  node: HTMLElement;
  /** The value to store; undefined leaves it unset. Throws on input that can't be read. */
  read(): unknown;
  /** Re-evaluate `when` and dependent options after a change elsewhere. */
  refresh(): void;
}

/** A row: an input with its unit, a slider with its value, a range's two ends. */
function inline(cls: string, ...kids: (Node | string)[]): HTMLElement {
  const node = el("div", { class: cls }, ...kids);
  node.style.display = "flex";
  node.style.alignItems = "center";
  node.style.gap = "8px";
  return node;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

let seq = 0;
export const nextId = (): string => `si-${++seq}`;

const labelOf = (f: InputDef, fallback: string): string => (typeof f.label === "string" ? f.label : fallback);

function textInput(f: InputDef, value: string, id: string, env: InputEnv, type = "text"): HTMLInputElement {
  const input = el("input", {
    id,
    class: `input${f.mono === true ? " mono" : ""}`,
    type: f.masked === true ? "password" : type,
    autocomplete: f.masked === true ? "new-password" : "off",
    spellcheck: "false",
    ...(typeof f.placeholder === "string" ? { placeholder: f.placeholder } : {}),
    ...(f.readonly === true ? { readOnly: "true" } : {}),
  });
  input.value = value;
  input.addEventListener("input", () => env.changed());
  return input;
}

const numberOf = (s: string, integer: boolean, what: string): number | undefined => {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)))
    throw new Error(`${what} must be ${integer ? "a whole number" : "a number"}`);
  return n;
};

function numberControl(type: string, f: InputDef, value: unknown, id: string, env: InputEnv): Control {
  const percent = type === "percent";
  const shown = typeof value === "number" ? (percent ? Math.round(value * 10000) / 100 : value) : "";
  const integer = f.integer === true;
  if (f.style === "slider") {
    const lo = typeof f.min === "number" ? f.min : typeof f.exclusiveMin === "number" ? f.exclusiveMin : 0;
    const hi = typeof f.max === "number" ? f.max : 1;
    const scale = percent ? 100 : 1;
    const range = el("input", {
      id,
      type: "range",
      min: String(lo * scale),
      max: String(hi * scale),
      step: String(typeof f.step === "number" ? f.step * scale : integer ? 1 : ((hi - lo) * scale) / 100),
    });
    range.value = String(shown === "" ? lo * scale : shown);
    const out = el("span", { class: "slider-value", text: `${range.value}${percent ? "%" : ""}` });
    range.addEventListener("input", () => {
      out.textContent = `${range.value}${percent ? "%" : ""}`;
      env.changed();
    });
    return {
      node: inline("slider", range, out),
      read: () => Number(range.value) / scale,
      refresh() {},
    };
  }
  const input = textInput(f, String(shown), id, env);
  input.inputMode = "decimal";
  const unit = percent ? "%" : typeof f.unit === "string" ? f.unit : undefined;
  return {
    node: unit === undefined ? input : inline("input-unit", input, el("span", { text: unit })),
    read: () => {
      const n = numberOf(input.value, integer && !percent, labelOf(f, "Value"));
      return n === undefined ? undefined : percent ? n / 100 : n;
    },
    refresh() {},
  };
}

/** duration / bytes / tokens: a number, or a unit string such as "5m", "64 KiB" or "128k" (core parses it). */
function unitControl(type: string, f: InputDef, value: unknown, id: string, env: InputEnv): Control {
  const input = textInput(
    {
      ...f,
      placeholder:
        typeof f.placeholder === "string"
          ? f.placeholder
          : `e.g. ${type === "duration" ? "5m" : type === "bytes" ? "64 KiB" : "128k"}`,
    },
    value === undefined || value === null ? "" : String(value),
    id,
    env,
  );
  const hint = unitHint(type);
  return {
    node: hint === undefined ? input : inline("input-unit", input, el("span", { text: hint })),
    read: () => {
      const s = input.value.trim();
      if (s === "") return undefined;
      return /^\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    },
    refresh() {},
  };
}

function rangeControl(f: InputDef, value: unknown, id: string, env: InputEnv): Control {
  const [lo, hi] = Array.isArray(value) ? value : [];
  const a = textInput(f, lo === undefined ? "" : String(lo), id, env);
  const b = textInput(f, hi === undefined ? "" : String(hi), nextId(), env);
  return {
    node: inline("range-pair", a, el("span", { text: "–" }), b),
    read: () => {
      const x = numberOf(a.value, f.integer === true, "From");
      const y = numberOf(b.value, f.integer === true, "To");
      return x === undefined && y === undefined ? undefined : [x ?? 0, y ?? 0];
    },
    refresh() {},
  };
}

function textArea(f: InputDef, value: string, id: string, env: InputEnv): HTMLTextAreaElement {
  const code = f.type === "code" || f.mono === true;
  const ta = el("textarea", {
    id,
    class: `input${code ? " mono" : ""}`,
    rows: String(typeof f.lines === "number" ? f.lines : code ? 5 : 3),
    spellcheck: "false",
    ...(typeof f.placeholder === "string" ? { placeholder: f.placeholder } : {}),
    ...(f.readonly === true ? { readOnly: "true" } : {}),
  });
  ta.value = value;
  ta.addEventListener("input", () => env.changed());
  return ta;
}

/** Options for a select: static, or fetched from a source with args from the form; reloaded when the args change. */
function optionLoader(
  f: InputDef,
  env: InputEnv,
  item: unknown,
  apply: (opts: OptionDef[], error?: string) => void,
) {
  const fixed = staticOptions(f);
  let lastArgs: string | undefined;
  const load = () => {
    if (fixed !== undefined) {
      if (lastArgs === undefined) apply(fixed);
      lastArgs = "static";
      return;
    }
    const src = f.options as { from: string; args?: Args };
    const args = resolveArgs(src.args, env.root(), item);
    const key = JSON.stringify(args);
    if (key === lastArgs) return;
    lastArgs = key;
    env
      .options(src.from, args)
      .then((opts) => apply(opts))
      .catch((e: unknown) => apply([], e instanceof Error ? e.message : String(e)));
  };
  return load;
}

function selectControl(f: InputDef, value: unknown, id: string, env: InputEnv, item: unknown): Control {
  const current = typeof value === "string" ? value : undefined;
  const fixed = staticOptions(f);
  if (fixed !== undefined && (f.style === "segmented" || f.style === "cards")) {
    let picked = current;
    const node = el("div", {
      class: "segmented",
      role: "radiogroup",
      id,
      "aria-label": labelOf(f, "Options"),
    });
    const buttons = fixed.map((o) => {
      const b = el("button", { type: "button", text: o.label ?? o.value });
      b.setAttribute("role", "radio");
      if (o.summary !== undefined) b.title = o.summary;
      b.addEventListener("click", () => {
        picked = o.value;
        for (const x of buttons) x.setAttribute("aria-checked", String(x === b));
        env.changed();
      });
      b.setAttribute("aria-checked", String(o.value === picked));
      node.append(b);
      return b;
    });
    return { node, read: () => picked, refresh() {} };
  }
  const select = el("select", { id });
  const note = el("div", { class: "field-desc" });
  note.hidden = true;
  let wanted = current;
  const fill = (opts: OptionDef[], error?: string) => {
    const keep = select.value !== "" ? select.value : wanted;
    select.replaceChildren(el("option", { value: "", text: f.required === true ? "Choose…" : "None" }));
    let group: HTMLOptGroupElement | undefined;
    for (const o of opts) {
      const opt = el("option", { value: o.value, text: o.label ?? o.value });
      if (o.group !== undefined) {
        if (group?.label !== o.group) {
          group = el("optgroup", { label: o.group });
          select.append(group);
        }
        group.append(opt);
      } else select.append(opt);
    }
    if (keep !== undefined && keep !== "" && !opts.some((o) => o.value === keep))
      select.append(el("option", { value: keep, text: `${keep} (not listed)` }));
    select.value = keep ?? "";
    wanted = undefined;
    note.hidden = error === undefined;
    note.textContent = error === undefined ? "" : `Options unavailable (${error}); the stored value is kept.`;
  };
  const load = optionLoader(f, env, item, fill);
  select.addEventListener("change", () => env.changed());
  if (f.readonly === true) select.disabled = true;
  load();
  return {
    node: el("div", {}, selectChip(select, "field-select"), note),
    read: () => (select.value === "" ? undefined : select.value),
    refresh: load,
  };
}

function multiControl(f: InputDef, value: unknown, id: string, env: InputEnv, item: unknown): Control {
  let picked = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const node = el("div", { class: `checklist${f.style === "chips" ? " chips" : ""}`, id, role: "group" });
  const fill = (opts: OptionDef[], error?: string) => {
    const all: OptionDef[] = [
      ...opts,
      ...[...picked].filter((v) => !opts.some((o) => o.value === v)).map((value) => ({ value })),
    ];
    node.replaceChildren(
      ...all.map((o) => {
        const box = el("input", { type: "checkbox" });
        box.checked = picked.has(o.value);
        box.addEventListener("change", () => {
          picked = new Set(picked);
          if (box.checked) picked.add(o.value);
          else picked.delete(o.value);
          env.changed();
        });
        return el("label", { class: "check" }, box, el("span", { text: o.label ?? o.value }));
      }),
      ...(error === undefined
        ? []
        : [el("div", { class: "field-desc", text: `Options unavailable: ${error}` })]),
    );
  };
  const load = optionLoader(f, env, item, fill);
  load();
  return {
    node,
    // Clearing sends [] (a real empty set), never null; the form leaves an untouched setting unset.
    read: () => [...picked],
    refresh: load,
  };
}

function tagsControl(f: InputDef, value: unknown, id: string, env: InputEnv): Control {
  const ta = textArea(
    { ...f, placeholder: "One per line" },
    Array.isArray(value) ? value.join("\n") : "",
    id,
    env,
  );
  return {
    node: ta,
    read: () =>
      ta.value
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x !== ""),
    refresh() {},
  };
}

/** A secret input stores only `${secret:<name>}`: pick a stored secret, or paste a value into a new one. */
function secretControl(f: InputDef, value: unknown, id: string, env: InputEnv, path: string): Control {
  let name = secretNameOf(value);
  const select = el("select", { id, "aria-label": labelOf(f, "Secret") });
  const meta = el("div", { class: "field-desc" });
  const nameInput = el("input", {
    class: "input mono",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
  });
  nameInput.value = pasteName(env.plugin, path);
  const pasteValue = el("input", {
    class: "input",
    type: "password",
    autocomplete: "new-password",
    placeholder: "Paste the value",
  });
  const save = el("button", { type: "button", class: "chip", text: "Store secret" });
  const paste = el("div", { class: "secret-paste" }, nameInput, pasteValue, save);
  paste.hidden = true;
  let known: SecretMeta[] = [];
  const fill = () => {
    select.replaceChildren(
      el("option", { value: "", text: "None" }),
      ...known.map((s) => el("option", { value: s.name, text: s.name })),
      el("option", { value: "\u0000paste", text: "Paste a new secret…" }),
    );
    if (name !== undefined && !known.some((s) => s.name === name))
      select.insertBefore(
        el("option", { value: name, text: `${name} (from environment or missing)` }),
        select.lastChild,
      );
    select.value = name ?? "";
  };
  void env
    .listSecrets()
    .then((list) => {
      known = list;
      fill();
    })
    .catch(fill);
  fill();
  select.addEventListener("change", () => {
    paste.hidden = select.value !== "\u0000paste";
    if (!paste.hidden) return pasteValue.focus();
    name = select.value === "" ? undefined : select.value;
    env.changed();
  });
  save.addEventListener("click", () => {
    const n = nameInput.value.trim();
    if (n === "" || pasteValue.value === "") return;
    if (known.some((s) => s.name === n) && !window.confirm(`Replace the stored secret "${n}"?`)) return;
    save.disabled = true;
    env
      .putSecret(n, pasteValue.value)
      .then(() => {
        pasteValue.value = "";
        paste.hidden = true;
        if (!known.some((s) => s.name === n)) known = [...known, { name: n, source: "file" }];
        name = n;
        fill();
        meta.textContent = "Stored. Save to use it.";
        env.changed();
      })
      .catch((e: unknown) => {
        meta.textContent = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        save.disabled = false;
      });
  });
  return {
    node: el("div", { class: "secret-picker" }, selectChip(select, "field-select"), paste, meta),
    read: () => (name === undefined ? undefined : `\${secret:${name}}`),
    refresh() {},
  };
}

/** A labelled child of a group, list item, map value or variant case, hidden while its `when` is false. */
interface Child {
  id: string;
  ctl: Control;
  wrap: HTMLElement;
  when: InputDef["when"];
}

function childField(def: InputDef, value: unknown, env: InputEnv, path: string, item: unknown): Child {
  const id = nextId();
  const ctl = inputControl(def, value, env, id, path, item);
  const label = labelOf(def, def.id ?? "");
  const wrap = el(
    "div",
    { class: `field${renderAs(def, env.types).type === "bool" ? " toggle" : ""}` },
    el("label", { class: "field-label", for: id, text: label + (def.required === true ? " *" : "") }),
    ...(typeof def.summary === "string" ? [el("div", { class: "field-desc", text: def.summary })] : []),
    ctl.node,
  );
  return { id: def.id ?? "", ctl, wrap, when: def.when };
}

function fieldsOf(
  inputs: unknown,
  value: Record<string, unknown>,
  env: InputEnv,
  path: string,
  item: unknown,
): { nodes: HTMLElement[]; children: Child[] } {
  const nodes: HTMLElement[] = [];
  const children: Child[] = [];
  for (const raw of Array.isArray(inputs) ? (inputs as (InputDef | DisplayDef)[]) : []) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || raw.type === undefined || isDisplayType(raw.type as string)) {
      nodes.push(env.display(raw as DisplayDef, item));
      continue;
    }
    const c = childField(raw as InputDef, value[raw.id], env, `${path}.${raw.id}`, item);
    children.push(c);
    nodes.push(c.wrap);
  }
  return { nodes, children };
}

const DISPLAYS = new Set(["heading", "note", "divider", "link", "badge", "stat", "meter", "table", "action"]);
const isDisplayType = (t: string) => DISPLAYS.has(t);

const readChildren = (
  children: Child[],
  keep: Record<string, unknown> = {},
): Record<string, unknown> | undefined => {
  const out: Record<string, unknown> = { ...keep };
  for (const c of children) {
    const v = c.ctl.read();
    if (v === undefined) delete out[c.id];
    else out[c.id] = v;
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

function refreshChildren(children: Child[], env: InputEnv, item: unknown): void {
  for (const c of children) {
    c.wrap.hidden = !evalCond(c.when, env.root(), item);
    c.ctl.refresh();
  }
}

function groupControl(f: InputDef, value: unknown, env: InputEnv, path: string, item: unknown): Control {
  const v = isRecord(value) ? value : {};
  const { nodes, children } = fieldsOf(f.inputs, v, env, path, item);
  const node = el("div", { class: `input-group ${f.layout === "row" ? "row" : "stack"}` }, ...nodes);
  const refresh = () => refreshChildren(children, env, item);
  refresh();
  return { node, read: () => readChildren(children), refresh };
}

function listControl(f: InputDef, value: unknown, env: InputEnv, path: string): Control {
  const node = el("div", { class: `rows${f.style === "table" ? " table" : ""}` });
  const list = el("div", { class: "rows-list" });
  const item = (isRecord(f.item) ? f.item : { type: "string" }) as InputDef;
  const rows: { ctl: Control; node: HTMLElement }[] = [];
  const add = (v: unknown) => {
    const i = rows.length;
    const ctl = inputControl(item, v, env, nextId(), `${path}[${i}]`, v);
    const remove = iconButton("trash", "Remove");
    remove.type = "button";
    const row = el("div", { class: "rows-row" }, ctl.node, remove);
    const entry = { ctl, node: row };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i < 0) return;
      rows.splice(i, 1);
      collapse(row);
      env.changed();
    });
    rows.push(entry);
    list.append(row);
  };
  for (const v of Array.isArray(value) ? value : []) add(v);
  const addBtn = el("button", {
    type: "button",
    class: "chip",
    text: typeof f.addLabel === "string" ? f.addLabel : "Add",
  });
  addBtn.addEventListener("click", () => {
    if (typeof f.max === "number" && rows.length >= f.max) return;
    add(undefined);
    const last = rows.at(-1);
    if (last !== undefined) enter(last.node);
    env.changed();
  });
  node.append(list, el("div", { class: "rows-add" }, addBtn));
  return {
    node,
    read: () => rows.map((r) => r.ctl.read()).filter((v) => v !== undefined),
    refresh: () => {
      for (const r of rows) r.ctl.refresh();
    },
  };
}

function mapControl(f: InputDef, value: unknown, env: InputEnv, path: string): Control {
  const node = el("div", { class: "rows map" });
  const list = el("div", { class: "rows-list" });
  const valueDef = (isRecord(f.value) ? f.value : { type: "string" }) as InputDef;
  const keyDef = (isRecord(f.key) ? f.key : { type: "string" }) as InputDef;
  const rows: { key: HTMLInputElement; ctl: Control; node: HTMLElement }[] = [];
  const add = (k: string, v: unknown) => {
    const key = textInput({ ...keyDef, placeholder: labelOf(keyDef, "Key") }, k, nextId(), env);
    const ctl = inputControl(valueDef, v, env, nextId(), `${path}[${JSON.stringify(k)}]`, v);
    const remove = iconButton("trash", "Remove");
    remove.type = "button";
    const row = el("div", { class: "rows-row" }, key, ctl.node, remove);
    const entry = { key, ctl, node: row };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i < 0) return;
      rows.splice(i, 1);
      collapse(row);
      env.changed();
    });
    rows.push(entry);
    list.append(row);
  };
  for (const [k, v] of Object.entries(isRecord(value) ? value : {})) add(k, v);
  const addBtn = el("button", { type: "button", class: "chip", text: "Add" });
  addBtn.addEventListener("click", () => {
    add("", undefined);
    const last = rows.at(-1);
    if (last !== undefined) enter(last.node);
    last?.key.focus();
  });
  node.append(list, el("div", { class: "rows-add" }, addBtn));
  return {
    node,
    read: () => {
      const out: Record<string, unknown> = {};
      for (const r of rows) {
        const k = r.key.value.trim();
        const v = r.ctl.read();
        if (k !== "" && v !== undefined) out[k] = v;
      }
      return out;
    },
    refresh: () => {
      for (const r of rows) r.ctl.refresh();
    },
  };
}

function variantControl(f: InputDef, value: unknown, env: InputEnv, path: string, item: unknown): Control {
  const tag = typeof f.tag === "string" ? f.tag : "kind";
  const cases = (Array.isArray(f.cases) ? f.cases : []) as {
    value: string;
    label?: string;
    inputs?: unknown;
  }[];
  const v = isRecord(value) ? value : {};
  const select = el("select", { "aria-label": labelOf(f, "Kind") });
  select.append(
    el("option", { value: "", text: "None" }),
    ...cases.map((c) => el("option", { value: c.value, text: c.label ?? c.value })),
  );
  select.value = typeof v[tag] === "string" ? (v[tag] as string) : "";
  const body = el("div", { class: "input-group stack" });
  let children: Child[] = [];
  const paint = (from: Record<string, unknown>) => {
    const c = cases.find((k) => k.value === select.value);
    const built = fieldsOf(c?.inputs ?? [], from, env, path, item);
    children = built.children;
    body.replaceChildren(...built.nodes);
    refreshChildren(children, env, item);
  };
  select.addEventListener("change", () => {
    paint({});
    env.changed();
  });
  paint(v);
  return {
    node: el("div", { class: "variant" }, selectChip(select, "field-select"), body),
    read: () => (select.value === "" ? undefined : { [tag]: select.value, ...readChildren(children) }),
    refresh: () => refreshChildren(children, env, item),
  };
}

function jsonControl(f: InputDef, value: unknown, id: string, env: InputEnv): Control {
  const ta = textArea(
    { ...f, type: "code" },
    value === undefined ? "" : JSON.stringify(value, null, 2),
    id,
    env,
  );
  return {
    node: ta,
    read: () => {
      if (ta.value.trim() === "") return undefined;
      try {
        return JSON.parse(ta.value);
      } catch {
        throw new Error(`${labelOf(f, "Value")} is not valid JSON`);
      }
    },
    refresh() {},
  };
}

/** The control for one input, rendered as its own type or the nearest base this UI knows. */
export function inputControl(
  input: InputDef,
  value: unknown,
  env: InputEnv,
  id: string,
  path: string,
  item?: unknown,
): Control {
  const { type, f } = renderAs(input, env.types);
  switch (type) {
    case "bool": {
      const box = el("input", { type: "checkbox", class: f.style === "checkbox" ? "" : "switch", id });
      box.checked = value === true;
      if (f.readonly === true) box.disabled = true;
      box.addEventListener("change", () => env.changed());
      return { node: box, read: () => box.checked, refresh() {} };
    }
    case "number":
    case "int":
    case "percent":
      return numberControl(type, f, value, id, env);
    case "duration":
    case "bytes":
    case "tokens":
      return unitControl(type, f, value, id, env);
    case "range":
      return rangeControl(f, value, id, env);
    case "text":
    case "code": {
      if (f.json === true) return jsonControl(f, value, id, env);
      const ta = textArea(f, typeof value === "string" ? value : "", id, env);
      return { node: ta, read: () => (ta.value === "" ? undefined : ta.value), refresh() {} };
    }
    case "secret":
      return secretControl(f, value, id, env, path);
    case "select":
    case "ref":
      return selectControl(f, value, id, env, item);
    case "multiselect":
      return multiControl(f, value, id, env, item);
    case "tags":
      return tagsControl(f, value, id, env);
    case "group":
      return groupControl(f, value, env, path, item);
    case "list":
      return listControl(f, value, env, path);
    case "map":
      return mapControl(f, value, env, path);
    case "variant":
      return variantControl(f, value, env, path, item);
    default: {
      const input = textInput(
        f,
        typeof value === "string" ? value : value === undefined ? "" : String(value),
        id,
        env,
        type === "color" ? "color" : "text",
      );
      return { node: input, read: () => (input.value === "" ? undefined : input.value), refresh() {} };
    }
  }
}
