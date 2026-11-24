import { el } from "../dom";
import { icon, selectChip } from "../icons";
import {
  CUSTOM_FIELDS,
  changedKeys,
  formatTokens,
  type ModelEntry,
  type ModelFields,
  parseTokens,
  sortLevels,
  tokensInput,
} from "../model-rows";
import { enter } from "../motion";
import { nextId } from "./settings-inputs";

export interface ModelItem {
  node: HTMLElement;
  provider: string;
  shown(): boolean;
  /** The entry as edited; throws on input that can't be read. */
  read(): ModelEntry;
  setOpen(open: boolean): void;
}

export interface ItemHooks {
  opened(item: ModelItem): void;
  remove(item: ModelItem): void;
  /** A value changed without an input event (a button, a reset). */
  changed(): void;
}

const LABELS: Record<keyof ModelFields, string> = {
  name: "Name",
  contextWindow: "Context",
  maxOutputTokens: "Max output",
  efforts: "Effort levels",
  defaultEffort: "Default effort",
  fast: "Fast mode",
};

function wasText(key: keyof ModelFields, base: ModelFields): string {
  const v = base[key];
  const shown =
    v === undefined || (Array.isArray(v) && v.length === 0)
      ? "not set"
      : typeof v === "boolean"
        ? v
          ? "on"
          : "off"
        : typeof v === "number"
          ? formatTokens(v)
          : Array.isArray(v)
            ? v.join(", ")
            : key === "name"
              ? `“${v}”`
              : v;
  return `${LABELS[key]} ${key === "efforts" ? "were" : "was"} ${shown}`;
}

const field = (label: string, control: HTMLElement, cls = ""): HTMLElement =>
  el("label", { class: `models-field ${cls}`.trim() }, el("span", { text: label }), control);

const textInput = (label: string, cls = ""): HTMLInputElement =>
  el("input", {
    class: `input ${cls}`.trim(),
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": label,
  });

function checked<T>(input: HTMLInputElement, read: () => T): T {
  try {
    const v = read();
    input.removeAttribute("aria-invalid");
    return v;
  } catch (e) {
    input.setAttribute("aria-invalid", "true");
    throw e;
  }
}

export function modelItem(entry: ModelEntry, hooks: ItemHooks): ModelItem {
  const { base, custom } = entry;
  const editId = nextId();

  const show = el("input", { type: "checkbox", class: "switch" });
  show.checked = entry.show;
  const title = el("span", { class: "models-title" });
  const dot = el("span", { class: "set-dot", title: "Edited" });
  const idText = el("span", { class: "models-id mono" });
  const head = el(
    "button",
    { type: "button", class: "models-name", "aria-expanded": "false", "aria-controls": editId },
    el("b", {}, title, dot),
    idText,
  );
  const facts = el("span", { class: "models-facts" });
  const tags = el("span", { class: "models-efforts" });
  const fastText = el("span", { class: "models-fast" });
  const row = el(
    "div",
    { class: "models-row" },
    show,
    head,
    facts,
    tags,
    fastText,
    el("span", { class: "models-chevron" }, icon("chevron")),
  );

  const idIn = textInput("Model ID", "mono");
  idIn.value = entry.id;
  const nameIn = textInput("Name");
  const ctxIn = textInput("Context window");
  const outIn = textInput("Max output");
  const levelBox = el("div", { class: "models-levels", role: "group", "aria-label": "Effort levels" });
  const defaultSel = el("select", { "aria-label": "Default effort" });
  const defaultField = field("Default effort", selectChip(defaultSel, "field-select models-select"));
  const fastIn = el("input", { type: "checkbox", class: "switch", "aria-label": "Fast mode" });
  const note = el("span", { class: "models-note" });
  const reset = el("button", { type: "button", class: "models-link", text: "Reset to provider defaults" });
  const remove = el("button", { type: "button", class: "models-link danger", text: "Remove model" });
  const edit = el(
    "div",
    { class: `models-edit${custom ? " custom" : ""}`, id: editId },
    ...(custom ? [field("Model ID", idIn)] : []),
    field("Name", nameIn),
    field("Context", ctxIn),
    field("Max output", outIn),
    el(
      "div",
      { class: "models-more" },
      el("div", { class: "models-field grow" }, el("span", { text: "Effort levels" }), levelBox),
      defaultField,
      field("Fast mode", fastIn, "toggle"),
    ),
    el("div", { class: "models-foot" }, note, custom ? remove : reset),
  );
  edit.hidden = true;
  const node = el("div", { class: "models-item" }, row, edit);

  let levels: string[] = [];
  const enabled = new Set<string>();

  const renderDefault = (want: string | undefined) => {
    const on = levels.filter((l) => enabled.has(l));
    defaultSel.replaceChildren(
      el("option", { value: "", text: "Not set" }),
      ...on.map((l) => el("option", { value: l, text: l })),
    );
    defaultSel.value = want !== undefined && enabled.has(want) ? want : "";
  };

  const addLevel = el("button", {
    type: "button",
    class: "models-effort add",
    "aria-label": "Add effort level",
  });
  addLevel.append(icon("plus"));
  const levelIn = textInput("New effort level", "models-level-input");
  levelIn.addEventListener("input", (ev) => ev.stopPropagation());
  addLevel.addEventListener("click", () => {
    addLevel.replaceWith(levelIn);
    levelIn.value = "";
    levelIn.focus();
  });
  const closeLevelIn = (save: boolean) => {
    if (!levelIn.isConnected) return;
    const l = levelIn.value.trim().toLowerCase();
    levelIn.replaceWith(addLevel);
    if (!save || l === "" || enabled.has(l)) return;
    levels = sortLevels([...levels, l]);
    enabled.add(l);
    renderLevels();
    hooks.changed();
    sync();
  };
  levelIn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === "Escape") {
      ev.preventDefault();
      closeLevelIn(ev.key === "Enter");
      addLevel.focus();
    }
  });
  levelIn.addEventListener("blur", () => closeLevelIn(true));

  function renderLevels() {
    const want = defaultSel.value || undefined;
    levelBox.replaceChildren(
      ...levels.map((l) => {
        const b = el("button", {
          type: "button",
          class: "models-effort",
          "aria-pressed": String(enabled.has(l)),
          text: l,
        });
        b.addEventListener("click", () => {
          if (enabled.has(l)) enabled.delete(l);
          else enabled.add(l);
          b.setAttribute("aria-pressed", String(enabled.has(l)));
          renderDefault(defaultSel.value || undefined);
          hooks.changed();
          sync();
        });
        return b;
      }),
      addLevel,
    );
    renderDefault(want);
  }

  const fill = (f: ModelFields) => {
    nameIn.value = f.name;
    ctxIn.value = tokensInput(f.contextWindow);
    outIn.value = tokensInput(f.maxOutputTokens);
    levels = sortLevels([...(base?.efforts ?? []), ...f.efforts]);
    enabled.clear();
    for (const l of f.efforts) enabled.add(l);
    renderLevels();
    renderDefault(f.defaultEffort);
    fastIn.checked = f.fast;
  };

  const readId = () =>
    custom
      ? checked(idIn, () => {
          const id = idIn.value.trim();
          if (id === "") throw new Error("Model ID is required");
          return id;
        })
      : entry.id;

  const tokens = (input: HTMLInputElement, fallback: number | undefined) =>
    checked(input, () => (input.value.trim() === "" ? fallback : parseTokens(input.value)));

  const fields = (): ModelFields => {
    const fallback = base ?? CUSTOM_FIELDS;
    const contextWindow = tokens(ctxIn, fallback.contextWindow);
    const maxOutputTokens = tokens(outIn, fallback.maxOutputTokens);
    const unusable = base?.defaultEffort !== undefined && !enabled.has(base.defaultEffort);
    const defaultEffort = defaultSel.value || (unusable ? (base?.defaultEffort ?? "") : "");
    return {
      name: nameIn.value.trim() || (base?.name ?? idIn.value.trim()),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      efforts: levels.filter((l) => enabled.has(l)),
      ...(defaultEffort === "" ? {} : { defaultEffort }),
      fast: fastIn.checked,
    };
  };

  let last = entry.fields;
  function sync() {
    try {
      last = fields();
    } catch {}
    const id = idIn.value.trim();
    title.textContent = last.name || id || "New model";
    idText.textContent = custom ? (id === "" ? "Added by hand" : `${id} · added by hand`) : entry.id;
    show.setAttribute("aria-label", `Show ${title.textContent} in the model picker`);
    head.setAttribute("aria-label", `Edit ${title.textContent}`);
    const size = (n: number | undefined, what: string) =>
      n === undefined ? [] : [`${formatTokens(n)} ${what}`];
    facts.textContent = [...size(last.contextWindow, "context"), ...size(last.maxOutputTokens, "out")].join(
      " · ",
    );
    tags.replaceChildren(
      ...last.efforts.map((l) =>
        el("span", { class: `models-tag${l === last.defaultEffort ? " default" : ""}`, text: l }),
      ),
    );
    fastText.textContent = last.fast ? "Fast" : "";
    node.classList.toggle("off", !show.checked);
    defaultField.hidden = levels.every((l) => !enabled.has(l));
    const changed = base === undefined ? [] : changedKeys(last, base);
    dot.hidden = changed.length === 0;
    note.textContent = base === undefined ? "" : changed.map((k) => wasText(k, base)).join(" · ");
    reset.hidden = changed.length === 0;
  }

  fill(entry.fields);
  sync();
  edit.addEventListener("input", sync);
  edit.addEventListener("change", sync);
  show.addEventListener("change", sync);
  row.addEventListener("click", (ev) => {
    if (ev.target === show) return;
    const open = !node.classList.contains("open");
    item.setOpen(open);
    if (open) hooks.opened(item);
  });
  reset.addEventListener("click", () => {
    if (base === undefined) return;
    fill(base);
    for (const input of [nameIn, ctxIn, outIn]) input.removeAttribute("aria-invalid");
    hooks.changed();
    sync();
  });
  remove.addEventListener("click", () => hooks.remove(item));

  const item: ModelItem = {
    node,
    provider: entry.provider,
    shown: () => show.checked,
    read: () => ({ ...entry, id: readId(), show: show.checked, fields: fields() }),
    setOpen(open) {
      if (open === node.classList.contains("open")) return;
      edit.hidden = !open;
      node.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
      if (!open) return;
      enter(edit);
      if (custom && idIn.value === "") idIn.focus();
    },
  };
  return item;
}
