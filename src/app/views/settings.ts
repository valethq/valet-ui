import { el, leave } from "../dom";
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
      const swap = (): void => {
        applyTheme(t.id);
        paint();
      };
      if ("startViewTransition" in document) document.startViewTransition(swap);
      else swap();
    });
    grid.append(b);
  }
  paint();
  return el("section", { class: "settings-section" }, grid);
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

interface Tab {
  label: string;
  panel: HTMLElement;
}

/** A tab strip with one visible panel at a time. Arrow, Home and End keys move
 * between tabs (WAI-ARIA tabs pattern). */
function tabbed(tabs: Tab[]): HTMLElement {
  const bar = el("div", { class: "settings-tabs", role: "tablist", "aria-label": "Settings sections" });
  const body = el("div", { class: "settings-panels" });
  const buttons = tabs.map((t, i) => {
    const id = `settings-tab-${i}`;
    const pid = `settings-panel-${i}`;
    t.panel.id = pid;
    t.panel.setAttribute("role", "tabpanel");
    t.panel.setAttribute("aria-labelledby", id);
    body.append(t.panel);
    return el("button", { class: "settings-tab", role: "tab", id, "aria-controls": pid, text: t.label });
  });
  const select = (i: number, focus = false): void => {
    tabs.forEach((t, j) => {
      const on = j === i;
      const b = buttons[j];
      if (b !== undefined) {
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      }
      t.panel.hidden = !on;
    });
    if (focus) buttons[i]?.focus();
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(i));
    b.addEventListener("keydown", (ev) => {
      const n = buttons.length;
      const next =
        ev.key === "ArrowRight"
          ? (i + 1) % n
          : ev.key === "ArrowLeft"
            ? (i - 1 + n) % n
            : ev.key === "Home"
              ? 0
              : ev.key === "End"
                ? n - 1
                : -1;
      if (next < 0) return;
      ev.preventDefault();
      select(next, true);
    });
    bar.append(b);
  });
  select(0);
  return el("div", { class: "settings-tabbed" }, bar, body);
}

/** Opens the settings dialog: a Theme tab, then one tab per plugin panel
 * registered on the `settings` scope. */
export function openSettings(deps: SettingsDeps): void {
  if (document.querySelector(".modal-backdrop:not(.leaving)") !== null) return;
  const opener = document.activeElement as HTMLElement | null;
  const close = iconButton("close", "Close");
  const content = el("div", { class: "modal-body" }, tabbed([{ label: "Theme", panel: themeSection() }]));
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
    content,
  );
  const backdrop = el("div", { class: "modal-backdrop" }, dialog);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") dismiss();
  };
  function dismiss(): void {
    leave(backdrop);
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
    .then((entries) => {
      const tabs = [
        { label: "Theme", panel: themeSection() },
        ...entries.map((e) => ({ label: e.title, panel: panelSection(e, deps) })),
      ];
      content.replaceChildren(tabbed(tabs));
    })
    .catch((e: unknown) =>
      content.append(
        el("div", { class: "hint error", text: `Plugin settings unavailable: ${errorText(e)}` }),
      ),
    );
}
