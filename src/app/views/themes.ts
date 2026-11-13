import { el } from "../dom";
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

const MAIN: (keyof ThemeColors)[] = ["bg", "text", "accent"];
const DETAIL: (keyof ThemeColors)[] = [
  "panel",
  "surface",
  "raised",
  "border",
  "strong",
  "muted",
  "faint",
  "on-accent",
  "user",
  "code",
  "danger",
  "warn",
  "ok",
];
const LABELS: Partial<Record<keyof ThemeColors, string>> = {
  bg: "Background",
  text: "Text",
  accent: "Accent",
  "on-accent": "Text on accent",
  user: "Your messages",
  strong: "Strong border",
};
const label = (k: string): string => LABELS[k as keyof ThemeColors] ?? k.charAt(0).toUpperCase() + k.slice(1);

/** `<input type=color>` only takes #rrggbb. */
function pickerValue(c: string): string {
  if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.replace(/[0-9a-f]/gi, "$&$&");
  return "#000000";
}

function colorRow(t: Theme, key: keyof ThemeColors, save: () => void): HTMLElement {
  const picker = el("input", { type: "color", class: "color-pick", "aria-label": label(key) });
  const text = el("input", {
    type: "text",
    class: "input mono color-text",
    "aria-label": `${label(key)} value`,
    spellcheck: "false",
  });
  const set = (v: string): void => {
    t.colors[key] = v;
    save();
  };
  const sync = (): void => {
    picker.value = pickerValue(t.colors[key]);
    text.value = t.colors[key];
    text.removeAttribute("aria-invalid");
  };
  picker.addEventListener("input", () => {
    set(picker.value);
    text.value = picker.value;
    text.removeAttribute("aria-invalid");
  });
  text.addEventListener("input", () => {
    const v = text.value.trim();
    if (COLOR_RE.test(v)) {
      set(v);
      picker.value = pickerValue(v);
      text.removeAttribute("aria-invalid");
    } else text.setAttribute("aria-invalid", "true");
  });
  sync();
  const row = el(
    "label",
    { class: "color-row" },
    el("span", { class: "color-name", text: label(key) }),
    picker,
    text,
  );
  row.addEventListener("resync", sync);
  return row;
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
    el("div", { class: "chip field-select" }, select),
    input,
  );
}

function editor(t: Theme, onRename: () => void, onDelete: () => void): HTMLElement {
  const persist = (): void => saveCustom(customThemes());
  const name = el("input", { type: "text", class: "input", "aria-label": "Theme name", maxlength: "40" });
  name.value = t.name;
  name.addEventListener("input", () => {
    t.name = name.value.trim() || "Untitled";
    persist();
    onRename();
  });

  const scheme = el(
    "select",
    { "aria-label": "Light or dark" },
    el("option", { text: "Dark" }),
    el("option", { text: "Light" }),
  );
  scheme.selectedIndex = t.scheme === "dark" ? 0 : 1;
  scheme.addEventListener("change", () => {
    t.scheme = scheme.selectedIndex === 0 ? "dark" : "light";
    t.colors.shadow = deriveColors(t.colors, t.scheme).shadow;
    persist();
  });

  const fonts = (): NonNullable<Theme["fonts"]> => {
    t.fonts ??= { ...DEFAULT_FONTS };
    return t.fonts;
  };
  const current = t.fonts ?? DEFAULT_FONTS;

  const rows = [...MAIN, ...DETAIL].map((k) => colorRow(t, k, persist));
  const autofill = el("button", { class: "chip", type: "button", text: "Fill in the rest from these three" });
  autofill.addEventListener("click", () => {
    const d = deriveColors(t.colors, t.scheme);
    for (const k of DETAIL) t.colors[k] = d[k];
    t.colors.shadow = d.shadow;
    persist();
    for (const r of rows) r.dispatchEvent(new Event("resync"));
  });

  const status = el("span", { class: "form-status" });
  const exportBtn = el("button", { class: "chip", type: "button", text: "Copy as JSON" });
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
  const del = el("button", { class: "chip danger", type: "button", text: "Delete theme" });
  del.addEventListener("click", () => {
    if (confirm(`Delete "${t.name}"?`)) onDelete();
  });

  return el(
    "div",
    { class: "theme-editor" },
    el("div", { class: "field" }, el("span", { class: "field-label", text: "Name" }), name),
    el(
      "div",
      { class: "field" },
      el("span", { class: "field-label", text: "Base" }),
      el("div", { class: "chip field-select" }, scheme),
    ),
    el(
      "div",
      { class: "font-fields" },
      fontField("Interface font", SANS_FONTS, current.sans, DEFAULT_FONTS.sans, (s) => {
        fonts().sans = s;
        persist();
      }),
      fontField("Code font", MONO_FONTS, current.mono, DEFAULT_FONTS.mono, (s) => {
        fonts().mono = s;
        persist();
      }),
    ),
    el("p", {
      class: "section-desc",
      text: "Fonts must be installed on this device, except Public Sans which is built in.",
    }),
    el("div", { class: "color-grid" }, ...rows.slice(0, MAIN.length)),
    el("div", { class: "form-actions start" }, autofill),
    el(
      "details",
      { class: "color-more" },
      el("summary", { text: "All colors" }),
      el("div", { class: "color-grid" }, ...rows.slice(MAIN.length)),
    ),
    el("div", { class: "form-actions" }, status, exportBtn, del),
  );
}

export function themeSection(): HTMLElement {
  const grid = el("div", { class: "theme-grid", role: "radiogroup", "aria-label": "Theme" });
  const editorSlot = el("div");
  const importBox = el("div", { class: "theme-import" });
  importBox.hidden = true;
  const importStatus = el("span", { class: "form-status" });

  const choose = (id: string): void => {
    const swap = (): void => {
      applyTheme(id);
      paint();
    };
    if ("startViewTransition" in document) document.startViewTransition(swap);
    else swap();
  };

  const renderGrid = (): void => {
    grid.replaceChildren(
      ...allThemes().map((t) => {
        const swatch = el("span", { class: "swatch" });
        swatch.style.background = `linear-gradient(135deg, ${t.colors.bg} 50%, ${t.colors.accent} 50%)`;
        const b = el(
          "button",
          { class: "theme-option", role: "radio", "data-theme": t.id, type: "button" },
          swatch,
          t.name,
        );
        b.addEventListener("click", () => choose(t.id));
        return b;
      }),
    );
  };

  function paint(): void {
    const id = currentTheme();
    for (const b of grid.children)
      b.setAttribute("aria-checked", String((b as HTMLElement).dataset.theme === id));
    const t = customThemes().find((c) => c.id === id);
    editorSlot.replaceChildren(
      ...(t === undefined
        ? []
        : [
            editor(
              t,
              () => {
                const b = grid.querySelector(`[data-theme="${t.id}"]`);
                if (b?.lastChild) b.lastChild.textContent = t.name;
              },
              () => {
                saveCustom(customThemes().filter((c) => c.id !== t.id));
                applyTheme(allThemes()[0]?.id ?? "mono");
                renderGrid();
                paint();
              },
            ),
          ]),
    );
  }

  const add = (t: Theme): void => {
    saveCustom([...customThemes(), t]);
    renderGrid();
    choose(t.id);
  };

  const copy = el("button", { class: "chip", type: "button", text: "New theme from this one" });
  copy.addEventListener("click", () => {
    const base = allThemes().find((t) => t.id === currentTheme());
    if (base !== undefined) add(copyTheme(base, base.custom ? `${base.name} copy` : `My ${base.name}`));
  });

  const toggleImport = el("button", { class: "chip", type: "button", text: "Import" });
  toggleImport.addEventListener("click", () => {
    importBox.hidden = !importBox.hidden;
    if (!importBox.hidden) importBox.querySelector("textarea")?.focus();
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
    add(t);
  });
  importBox.append(paste, el("div", { class: "form-actions" }, importStatus, addImported));

  renderGrid();
  paint();
  return el(
    "section",
    { class: "settings-section" },
    grid,
    el("div", { class: "form-actions start" }, copy, toggleImport),
    importBox,
    editorSlot,
  );
}
