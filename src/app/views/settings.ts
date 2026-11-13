import { el } from "../dom";
import { iconButton } from "../icons";
import { applyTheme, currentTheme, THEMES } from "../themes";
import type { SettingsEntry } from "../types";
import { schemaForm } from "./schema-form";

export interface SettingsDeps {
  load(): Promise<SettingsEntry[]>;
  save(key: string, values: Record<string, unknown>): Promise<SettingsEntry>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function themeSection(): HTMLElement {
  const grid = el("div", { class: "theme-grid", role: "radiogroup", "aria-label": "Theme" });
  const paint = (): void => {
    for (const b of grid.children)
      b.setAttribute("aria-checked", String((b as HTMLElement).dataset.theme === currentTheme()));
  };
  for (const t of THEMES) {
    const swatch = el("span", { class: "swatch" });
    swatch.style.background = `linear-gradient(135deg, ${t.colors.bg} 50%, ${t.colors.accent} 50%)`;
    const b = el("button", { class: "theme-option", role: "radio", "data-theme": t.id }, swatch, t.name);
    b.addEventListener("click", () => {
      applyTheme(t.id);
      paint();
    });
    grid.append(b);
  }
  paint();
  return el("section", { class: "settings-section" }, el("h3", { text: "Theme" }), grid);
}

function panelSection(entry: SettingsEntry, deps: SettingsDeps): HTMLElement {
  const form = schemaForm(entry.schema, entry.values);
  const status = el("span", { class: "form-status" });
  const save = el("button", { class: "primary", text: "Save" });
  const section = el(
    "section",
    { class: "settings-section" },
    el("h3", {}, entry.title, el("span", { class: "plugin-id", text: entry.plugin })),
    ...(entry.description === undefined ? [] : [el("p", { class: "section-desc", text: entry.description })]),
    form.node,
    el("div", { class: "form-actions" }, status, save),
  );
  save.addEventListener("click", () => {
    status.className = "form-status";
    status.textContent = "";
    let values: Record<string, unknown>;
    try {
      values = form.read();
    } catch (e) {
      status.className = "form-status error";
      status.textContent = errorText(e);
      return;
    }
    save.disabled = true;
    deps
      .save(entry.key, values)
      .then((next) => {
        const fresh = panelSection(next, deps);
        section.replaceWith(fresh);
        const s = fresh.querySelector(".form-status");
        if (s !== null) s.textContent = "Saved";
      })
      .catch((e: unknown) => {
        save.disabled = false;
        status.className = "form-status error";
        status.textContent = errorText(e);
      });
  });
  return section;
}

/** Opens the settings dialog: the theme, then one form per plugin panel
 * registered on the `settings` scope. */
export function openSettings(deps: SettingsDeps): void {
  if (document.querySelector(".modal-backdrop") !== null) return;
  const opener = document.activeElement as HTMLElement | null;
  const close = iconButton("close", "Close");
  const plugins = el("div", { class: "plugin-sections" }, el("div", { class: "hint", text: "Loading…" }));
  const dialog = el(
    "div",
    {
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "settings-title",
      tabindex: "-1",
    },
    el("div", { class: "modal-head" }, el("h2", { id: "settings-title", text: "Settings" }), close),
    el("div", { class: "modal-body" }, themeSection(), plugins),
  );
  const backdrop = el("div", { class: "modal-backdrop" }, dialog);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") dismiss();
  };
  function dismiss(): void {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    opener?.focus();
  }
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("pointerdown", (ev) => {
    if (ev.target === backdrop) dismiss();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  dialog.focus();

  deps
    .load()
    .then((entries) => plugins.replaceChildren(...entries.map((e) => panelSection(e, deps))))
    .catch((e: unknown) =>
      plugins.replaceChildren(
        el("div", { class: "hint error", text: `Plugin settings unavailable: ${errorText(e)}` }),
      ),
    );
}
