import { el, leave } from "../dom";
import { EXPERIMENTAL_KEY, experimentalEntry, saveExperimental } from "../experimental";
import { iconButton } from "../icons";
import type { SettingsEntry } from "../types";
import { refreshInterval, renderBlocks } from "./blocks";
import { schemaForm } from "./schema-form";
import { themeSection } from "./themes";

export interface SettingsDeps {
  load(): Promise<SettingsEntry[]>;
  save(key: string, values: Record<string, unknown>): Promise<SettingsEntry>;
  refresh(key: string): Promise<SettingsEntry>;
  action(key: string, name: string, args: Record<string, unknown>): Promise<SettingsEntry>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function panelSection(entry: SettingsEntry, deps: SettingsDeps): HTMLElement {
  // The section node is the tabpanel tabbed() wires up; keep it stable and
  // re-render only its children, or the tab's hidden/id wiring is lost.
  const section = el("section", { class: "settings-section" });
  const blocks = el("div", { class: "blocks" });
  let timer: ReturnType<typeof setInterval> | undefined;
  let latest = entry;

  const showBlocks = (panel: SettingsEntry): void => {
    latest = panel;
    const nodes = renderBlocks(panel.blocks ?? [], {
      run: async (name, args) => {
        showBlocks(await deps.action(panel.key, name, args));
      },
    });
    if (panel.viewError !== undefined) {
      nodes.push(el("div", { class: "hint error", text: `Could not load this panel: ${panel.viewError}` }));
    }
    blocks.replaceChildren(...nodes);
    blocks.hidden = nodes.length === 0;
  };

  // Poll only while the panel is on screen; stop for good once the dialog is gone.
  const startRefresh = (ms: number): void => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!section.isConnected) return clearInterval(timer);
      if (section.hidden || document.hidden) return;
      deps
        .refresh(latest.key)
        .then(showBlocks)
        .catch(() => {});
    }, ms);
  };

  const render = (panel: SettingsEntry): void => {
    const form = panel.schema === undefined ? undefined : schemaForm(panel.schema, panel.values ?? {});
    const status = el("span", { class: "form-status" });
    const save = el("button", { class: "primary", text: "Save" });
    showBlocks(panel);
    const ms = refreshInterval(panel.refreshMs);
    if (ms !== undefined) startRefresh(ms);
    section.replaceChildren(
      el(
        "h3",
        {},
        panel.title,
        panel.pluginName === undefined
          ? el("span", { class: "plugin-id", text: panel.plugin })
          : el("span", { class: "plugin-name", text: panel.pluginName, title: panel.plugin }),
      ),
      ...(panel.description === undefined
        ? []
        : [el("p", { class: "section-desc", text: panel.description })]),
      blocks,
      ...(form === undefined ? [] : [form.node, el("div", { class: "form-actions" }, status, save)]),
    );
    save.addEventListener("click", () => {
      if (form === undefined) return;
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
        .save(panel.key, values)
        .then((next) => {
          // The save response has no plugin name; keep the one the panel was listed with.
          render({ ...next, pluginName: panel.pluginName });
          const s = section.querySelector(".form-status");
          if (s !== null) s.textContent = "Saved";
        })
        .catch((e: unknown) => {
          save.disabled = false;
          status.className = "form-status error";
          status.textContent = errorText(e);
        });
    });
  };
  render(entry);
  return section;
}

interface Tab {
  label: string;
  panel: HTMLElement;
}

/** A vertical tab list beside one visible panel at a time. Up/Down, Home and End
 * move between tabs (WAI-ARIA tabs pattern, vertical orientation). */
function tabbed(tabs: Tab[]): HTMLElement {
  const bar = el("div", {
    class: "settings-tabs",
    role: "tablist",
    "aria-orientation": "vertical",
    "aria-label": "Settings sections",
  });
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
        ev.key === "ArrowDown" || ev.key === "ArrowRight"
          ? (i + 1) % n
          : ev.key === "ArrowUp" || ev.key === "ArrowLeft"
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

/** Saves the Experimental panel in this browser; everything else goes to the server. */
const withLocalPanels = (deps: SettingsDeps): SettingsDeps => ({
  ...deps,
  save: (key, values) =>
    key === EXPERIMENTAL_KEY ? Promise.resolve(saveExperimental(values)) : deps.save(key, values),
});

/** Opens the settings dialog: Theme and Experimental tabs, then one tab per
 * plugin panel registered on the `settings` scope. */
export function openSettings(serverDeps: SettingsDeps): void {
  const deps = withLocalPanels(serverDeps);
  if (document.querySelector(".modal-backdrop:not(.leaving)") !== null) return;
  const opener = document.activeElement as HTMLElement | null;
  const close = iconButton("close", "Close");
  const content = el(
    "div",
    { class: "modal-body" },
    tabbed([
      { label: "Theme", panel: themeSection() },
      { label: "Experimental", panel: panelSection(experimentalEntry(), deps) },
    ]),
  );
  const dialog = el(
    "div",
    {
      class: "modal settings-modal",
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
        { label: "Experimental", panel: panelSection(experimentalEntry(), deps) },
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
