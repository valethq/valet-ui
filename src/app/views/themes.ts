import { el } from "../dom";
import { icon } from "../icons";
import {
  allThemes,
  applyTheme,
  COLOR_RE,
  type FontChoice,
  type Theme,
  type ThemeColors,
  cleanFontStack,
  copyTheme,
  currentTheme,
  customThemes,
  DEFAULT_FONTS,
  deriveColors,
  exportTheme,
  importTheme,
  MONO_FONTS,
  SANS_FONTS,
  saveCustom,
} from "../themes";

type Key = keyof ThemeColors;

const BASE: Key[] = ["bg", "text", "accent"];
const GROUPS: [string, Key[]][] = [
  ["Surfaces", ["panel", "surface", "raised", "code", "user"]],
  ["Text", ["muted", "faint", "on-accent"]],
  ["Lines", ["border", "strong"]],
  ["Status", ["ok", "warn", "danger"]],
];

const INFO: Record<Exclude<Key, "shadow">, [string, string]> = {
  bg: ["Background", "The page behind everything"],
  text: ["Text", "Messages and headings"],
  accent: ["Accent", "Send button, switches, selection"],
  panel: ["Panel", "Sidebar and side panes"],
  surface: ["Surface", "Composer, dialogs and menus"],
  raised: ["Raised", "Inputs and the selected row"],
  code: ["Code", "Code blocks and tool output"],
  user: ["Your messages", "Bubbles for what you send"],
  muted: ["Muted", "Secondary text"],
  faint: ["Faint", "Placeholders and timestamps"],
  "on-accent": ["On accent", "Icons and text on the accent"],
  border: ["Border", "Dividers and outlines"],
  strong: ["Strong border", "Focused fields, scrollbars"],
  ok: ["Success", "Finished runs"],
  warn: ["Warning", "Things that need a look"],
  danger: ["Danger", "Errors and delete buttons"],
};
const name = (k: Key): string => (k === "shadow" ? "Shadow" : INFO[k][0]);

/** `<input type=color>` only takes #rrggbb. */
function pickerValue(c: string): string {
  if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.replace(/[0-9a-f]/gi, "$&$&");
  return "#000000";
}

/** Scopes a theme's variables to one element, so previews of other themes
 * render inside whatever theme is applied. */
function paintVars(node: HTMLElement, t: Theme): void {
  for (const [k, v] of Object.entries(t.colors)) node.style.setProperty(`--${k}`, v);
  const f = t.fonts ?? DEFAULT_FONTS;
  node.style.setProperty("--font", `${f.sans}, sans-serif`);
  node.style.setProperty("--mono", `${f.mono}, monospace`);
  node.style.setProperty("--font-head", f.heading === undefined ? "var(--font)" : `${f.heading}, sans-serif`);
}

function tileArt(t: Theme): HTMLElement {
  const art = el(
    "span",
    { class: "tile-art", "aria-hidden": "true" },
    el("span", { class: "ta-side" }, el("span", { class: "ta-row" }), el("span", { class: "ta-row dim" })),
    el("span", { class: "ta-bubble" }),
    el("span", { class: "ta-line" }),
    el("span", { class: "ta-line dim" }),
    el("span", { class: "ta-composer" }, el("span", { class: "ta-send" })),
  );
  paintVars(art, t);
  return art;
}

const spot = (tag: "span" | "div" | "p", key: Key, cls: string, ...kids: (Node | string)[]): HTMLElement =>
  el(tag, { class: cls, "data-key": key }, ...kids);

/** A small mock of the app. Every part is tagged with the colour it uses. */
function preview(): HTMLElement {
  const send = spot("span", "accent", "tp-send", spot("span", "on-accent", "tp-arrow", icon("send")));
  return el(
    "div",
    { class: "theme-preview" },
    spot(
      "div",
      "panel",
      "tp-side",
      spot("span", "text", "tp-brand", "valet"),
      spot("span", "raised", "tp-row on", spot("span", "text", "", "Build fixes")),
      spot("span", "muted", "tp-row", "Trip ideas"),
      spot("span", "faint", "tp-row", "Last week"),
    ),
    spot(
      "div",
      "bg",
      "tp-main",
      spot("div", "user", "tp-user", spot("span", "text", "", "Did the build pass?")),
      spot("p", "text", "tp-reply", "All green in 4.2s."),
      spot("p", "muted", "tp-sub", "Two warnings, nothing urgent."),
      spot(
        "div",
        "code",
        "tp-code",
        spot("span", "text", "", "$ bun test"),
        el(
          "span",
          { class: "tp-status" },
          spot("span", "ok", "", "14 pass"),
          spot("span", "warn", "", "2 warn"),
          spot("span", "danger", "", "0 fail"),
        ),
      ),
      spot("div", "surface", "tp-composer", spot("span", "faint", "tp-ph", "Reply..."), send),
    ),
  );
}

function fontField(
  title: string,
  choices: FontChoice[],
  current: string,
  fallback: string,
  onChange: (stack: string) => void,
): HTMLElement {
  const preset = choices.findIndex((c) => c.stack === current);
  const select = el("select", { "aria-label": title });
  for (const c of choices) select.append(el("option", { text: c.name }));
  select.append(el("option", { text: "Custom..." }));
  select.selectedIndex = preset < 0 ? choices.length : preset;
  const input = el("input", {
    type: "text",
    class: "input mono",
    placeholder: `Font names, e.g. Inter, "Helvetica Neue"`,
    "aria-label": `${title} font names`,
    spellcheck: "false",
  });
  input.value = preset < 0 ? current : "";
  input.hidden = preset >= 0;
  select.addEventListener("change", () => {
    const c = choices[select.selectedIndex];
    input.hidden = c !== undefined;
    if (c !== undefined) onChange(c.stack);
    else {
      if (input.value === "")
        input.value = (choices.find((x) => x.stack === fallback) ?? choices[0])?.name ?? "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    }
  });
  input.addEventListener("input", () => {
    const stack = cleanFontStack(input.value);
    if (stack === null) input.setAttribute("aria-invalid", "true");
    else {
      input.removeAttribute("aria-invalid");
      onChange(stack);
    }
  });
  return el(
    "div",
    { class: "field" },
    el("span", { class: "field-label", text: title }),
    el("div", { class: "chip field-select" }, select, el("span", { class: "chevron" }, icon("chevron"))),
    input,
  );
}

const PERSIST_MS = 250;
/** The pane with an edit not yet saved, so closing the tab inside the delay does not lose it. */
let unsaved: (() => void) | undefined;
let flushOnExit = false;

interface PaneHooks {
  /** The theme changed in a way the library tile should show. */
  changed(): void;
  customize(): void;
  remove(): void;
}

/** The right-hand side: a clickable preview, the colour swatches and fonts.
 * Built-in themes are shown read-only. */
function pane(t: Theme, hooks: PaneHooks): HTMLElement {
  const editable = t.custom === true;
  // The preview repaints on every input; the stylesheet and storage are rewritten once the edit settles
  // (the picker's release, a pause in typing), not on each frame of a colour drag.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const flush = (): void => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    if (unsaved === flush) unsaved = undefined;
    saveCustom(customThemes());
    hooks.changed();
  };
  const persist = (): void => {
    dirty = true;
    unsaved = flush;
    if (!flushOnExit) {
      flushOnExit = true;
      window.addEventListener("pagehide", () => unsaved?.());
    }
    clearTimeout(timer);
    timer = setTimeout(flush, PERSIST_MS);
  };

  const view = preview();
  view.classList.toggle("editable", editable);
  const swatches = new Map<Key, HTMLElement>();
  let picked: Key = "accent";

  const chip = el("span", { class: "ci-chip" });
  const picker = el("input", {
    type: "color",
    class: "ci-picker",
    "aria-label": "Pick colour",
    tabindex: "-1",
  });
  const ciName = el("span", { class: "ci-name" });
  const ciDesc = el("span", { class: "ci-desc" });
  const hex = el("input", {
    type: "text",
    class: "input mono ci-hex",
    "aria-label": "Colour value",
    spellcheck: "false",
  });
  hex.readOnly = !editable;
  picker.disabled = !editable;
  const inspector = el(
    "div",
    { class: "color-inspector" },
    el("label", { class: "ci-swatch" }, chip, picker),
    el("div", { class: "ci-text" }, ciName, ciDesc),
    hex,
  );

  const refresh = (): void => {
    paintVars(view, t);
    for (const [k, s] of swatches) s.style.setProperty("--c", t.colors[k]);
    const v = t.colors[picked];
    chip.style.background = v;
    picker.value = pickerValue(v);
    if (document.activeElement !== hex) hex.value = v;
  };

  const pick = (k: Key, open: boolean): void => {
    picked = k;
    ciName.textContent = name(k);
    ciDesc.textContent = k === "shadow" ? "" : INFO[k][1];
    hex.removeAttribute("aria-invalid");
    for (const [sk, s] of swatches) s.setAttribute("aria-pressed", String(sk === k));
    for (const n of view.querySelectorAll<HTMLElement>("[data-key]"))
      n.classList.toggle("picked", n.dataset.key === k);
    refresh();
    if (open && editable) {
      try {
        picker.showPicker();
      } catch {
        picker.click();
      }
    }
  };

  const set = (v: string): void => {
    t.colors[picked] = v;
    refresh();
    persist();
  };
  picker.addEventListener("input", () => {
    hex.removeAttribute("aria-invalid");
    set(picker.value);
  });
  picker.addEventListener("change", flush);
  hex.addEventListener("input", () => {
    const v = hex.value.trim();
    if (!COLOR_RE.test(v)) {
      hex.setAttribute("aria-invalid", "true");
      return;
    }
    hex.removeAttribute("aria-invalid");
    set(v);
  });
  hex.addEventListener("blur", refresh);

  view.addEventListener("click", (ev) => {
    const n = (ev.target as Element).closest<HTMLElement>("[data-key]");
    if (n?.dataset.key !== undefined) pick(n.dataset.key as Key, true);
  });

  const swatch = (k: Key, big = false): HTMLElement => {
    const b = el(
      "button",
      { class: big ? "swatch-tile big" : "swatch-tile", type: "button", title: name(k) },
      el("span", { class: "swatch-chip" }),
      el("span", { class: "swatch-name", text: name(k) }),
    );
    b.addEventListener("click", () => pick(k, true));
    swatches.set(k, b);
    return b;
  };

  const group = (title: string, keys: Key[], big = false, ...extra: HTMLElement[]): HTMLElement =>
    el(
      "div",
      { class: "swatch-group" },
      el("span", { class: "group-label", text: title }),
      el(
        "div",
        { class: big ? "swatch-row big" : "swatch-row" },
        ...keys.map((k) => swatch(k, big)),
        ...extra,
      ),
    );

  const extras: HTMLElement[] = [];
  if (editable) {
    const derive = el("button", {
      class: "chip",
      type: "button",
      title: "Work out every other colour from these three",
    });
    derive.append(icon("sparkles"), "Fill in the rest");
    derive.addEventListener("click", () => {
      const d = deriveColors(t.colors, t.scheme);
      for (const [, keys] of GROUPS) for (const k of keys) t.colors[k] = d[k];
      t.colors.shadow = d.shadow;
      refresh();
      persist();
    });
    extras.push(el("div", { class: "derive" }, derive));
  }

  const head = el("div", { class: "pane-head" });
  if (editable) {
    const title = el("input", {
      type: "text",
      class: "pane-name",
      "aria-label": "Theme name",
      maxlength: "40",
    });
    title.value = t.name;
    title.addEventListener("input", () => {
      t.name = title.value.trim() || "Untitled";
      persist();
    });
    const seg = el("div", { class: "segmented", role: "radiogroup", "aria-label": "Light or dark" });
    const opts = (["dark", "light"] as const).map((s) => {
      const b = el("button", { type: "button", role: "radio", text: s === "dark" ? "Dark" : "Light" });
      b.addEventListener("click", () => {
        t.scheme = s;
        t.colors.shadow = deriveColors(t.colors, s).shadow;
        for (const [o, os] of opts) o.setAttribute("aria-checked", String(os === t.scheme));
        persist();
      });
      return [b, s] as const;
    });
    for (const [o, os] of opts) {
      o.setAttribute("aria-checked", String(os === t.scheme));
      seg.append(o);
    }
    head.append(title, seg);
  } else {
    const customize = el("button", { class: "primary", type: "button" });
    customize.append(icon("pencil"), "Customize");
    customize.addEventListener("click", hooks.customize);
    head.append(
      el(
        "div",
        { class: "pane-title" },
        el("h3", { text: t.name }),
        el("span", { class: "pane-sub", text: `Built in · ${t.scheme === "dark" ? "Dark" : "Light"}` }),
      ),
      customize,
    );
  }

  const fonts = (): NonNullable<Theme["fonts"]> => {
    t.fonts ??= { ...DEFAULT_FONTS };
    return t.fonts;
  };
  const current = t.fonts ?? DEFAULT_FONTS;
  const fontGroup = editable
    ? [
        el(
          "div",
          { class: "swatch-group" },
          el("span", { class: "group-label", text: "Fonts" }),
          el(
            "div",
            { class: "font-fields" },
            fontField("Interface", SANS_FONTS, current.sans, DEFAULT_FONTS.sans, (s) => {
              fonts().sans = s;
              paintVars(view, t);
              persist();
            }),
            fontField("Code", MONO_FONTS, current.mono, DEFAULT_FONTS.mono, (s) => {
              fonts().mono = s;
              paintVars(view, t);
              persist();
            }),
          ),
          el("p", {
            class: "field-desc",
            text: "Fonts must be installed on this device, except Public Sans which is built in.",
          }),
        ),
      ]
    : [];

  const status = el("span", { class: "form-status" });
  const exportBtn = el("button", { class: "chip", type: "button" });
  exportBtn.append(icon("copy"), "Copy as JSON");
  exportBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(exportTheme(t)).then(
      () => {
        status.textContent = "Copied";
      },
      () => {
        status.textContent = "Clipboard unavailable";
      },
    );
  });
  const actions = el("div", { class: "form-actions" }, status, exportBtn);
  if (editable) {
    const del = el("button", { class: "chip danger", type: "button" });
    del.append(icon("trash"), "Delete");
    del.addEventListener("click", () => {
      if (confirm(`Delete "${t.name}"?`)) hooks.remove();
    });
    actions.append(del);
  }

  const node = el(
    "div",
    { class: "theme-pane" },
    head,
    el("div", { class: "pane-stick" }, view, inspector),
    el(
      "p",
      { class: "field-desc pane-hint" },
      editable
        ? "Click any part of the preview or a swatch to change its colour."
        : "Built-in themes can't be changed. Customize makes an editable copy.",
    ),
    group("Base", BASE, true, ...extras),
    ...GROUPS.map(([title, keys]) => group(title, keys)),
    ...fontGroup,
    actions,
  );
  pick(picked, false);
  return node;
}

export function themeSection(): HTMLElement {
  const lists = el("div", { class: "theme-lists" });
  const paneSlot = el("div", { class: "theme-pane-slot" });
  const importBox = el("div", { class: "theme-import" });
  importBox.hidden = true;
  const importStatus = el("span", { class: "form-status" });
  const tiles = new Map<string, HTMLButtonElement>();

  const choose = (id: string): void => {
    const swap = (): void => {
      applyTheme(id);
      paint();
    };
    if ("startViewTransition" in document) document.startViewTransition(swap);
    else swap();
  };

  const tile = (t: Theme): HTMLButtonElement => {
    const b = el(
      "button",
      { class: "theme-tile", role: "radio", "data-theme": t.id, type: "button", title: t.name },
      tileArt(t),
      el("span", { class: "tile-name", text: t.name }),
    );
    b.addEventListener("click", () => choose(t.id));
    tiles.set(t.id, b);
    return b;
  };

  const grid = (title: string, list: Theme[]): HTMLElement =>
    el(
      "div",
      { class: "theme-group" },
      el("span", { class: "group-label", text: title }),
      el("div", { class: "theme-grid", role: "radiogroup", "aria-label": title }, ...list.map(tile)),
    );

  const renderLists = (): void => {
    tiles.clear();
    const mine = customThemes();
    lists.replaceChildren(
      ...(mine.length > 0 ? [grid("Yours", mine)] : []),
      grid(
        "Built in",
        allThemes().filter((t) => t.custom !== true),
      ),
    );
  };

  function paint(): void {
    const id = currentTheme();
    for (const [tid, b] of tiles) b.setAttribute("aria-checked", String(tid === id));
    const t = allThemes().find((x) => x.id === id);
    if (t === undefined) {
      paneSlot.replaceChildren();
      return;
    }
    paneSlot.replaceChildren(
      pane(t, {
        changed: () => {
          const old = tiles.get(t.id);
          if (old !== undefined) {
            old.title = t.name;
            old.replaceChildren(tileArt(t), el("span", { class: "tile-name", text: t.name }));
          }
        },
        customize: () => add(copyTheme(t, `My ${t.name}`)),
        remove: () => {
          saveCustom(customThemes().filter((c) => c.id !== t.id));
          renderLists();
          choose(allThemes()[0]?.id ?? "mono");
        },
      }),
    );
  }

  const add = (t: Theme): void => {
    saveCustom([...customThemes(), t]);
    renderLists();
    choose(t.id);
  };

  const newBtn = el("button", { class: "chip", type: "button", title: "New theme based on the current one" });
  newBtn.append(icon("plus"), "New");
  newBtn.addEventListener("click", () => {
    const base = allThemes().find((t) => t.id === currentTheme());
    if (base !== undefined) add(copyTheme(base, base.custom ? `${base.name} copy` : `My ${base.name}`));
  });

  const toggleImport = el("button", { class: "chip", type: "button", "aria-expanded": "false" });
  toggleImport.append(icon("import"), "Import");
  toggleImport.addEventListener("click", () => {
    importBox.hidden = !importBox.hidden;
    toggleImport.setAttribute("aria-expanded", String(!importBox.hidden));
    if (!importBox.hidden) paste.focus();
  });
  const paste = el("textarea", {
    class: "input mono",
    rows: "5",
    placeholder: "Paste theme JSON",
    "aria-label": "Theme JSON",
    spellcheck: "false",
  });
  const addImported = el("button", { class: "primary", type: "button", text: "Add" });
  addImported.addEventListener("click", () => {
    const t = importTheme(paste.value);
    if (t === null) {
      importStatus.className = "form-status error";
      importStatus.textContent = "That isn't a valid theme";
      return;
    }
    paste.value = "";
    importStatus.textContent = "";
    importBox.hidden = true;
    toggleImport.setAttribute("aria-expanded", "false");
    add(t);
  });
  importBox.append(paste, el("div", { class: "form-actions" }, importStatus, addImported));

  renderLists();
  paint();
  // Bring the current theme into view once, when the tab opens. Clicking a
  // tile never scrolls the list.
  requestAnimationFrame(() => {
    const on = tiles.get(currentTheme());
    const row = on?.parentElement;
    if (on !== undefined && row != null && row.scrollWidth > row.clientWidth)
      row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  });
  return el(
    "section",
    { class: "settings-section theme-studio" },
    el(
      "div",
      { class: "theme-library" },
      el(
        "div",
        { class: "library-head" },
        el("h3", { text: "Themes" }),
        el("div", { class: "library-actions" }, newBtn, toggleImport),
      ),
      importBox,
      lists,
    ),
    paneSlot,
  );
}
