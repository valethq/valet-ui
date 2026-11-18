import { getSecretMeta, listCoreSettings, listModels, patchCoreSettings, putSecret } from "../api";
import { el, leave } from "../dom";
import { EXPERIMENTAL_KEY, experimentalEntry, saveExperimental } from "../experimental";
import { iconButton } from "../icons";
import type { CorePluginSettings, SettingsEntry } from "../types";
import { refreshInterval, renderBlocks } from "./blocks";
import { schemaForm, type SchemaFormDeps } from "./schema-form";
import { buildSettingsPages, GROUP_LABEL, groupPages, type SettingsPage } from "./settings-pages";
import { themeSection } from "./themes";

export interface SettingsDeps {
  load(): Promise<SettingsEntry[]>;
  save(key: string, values: Record<string, unknown>): Promise<SettingsEntry>;
  refresh(key: string): Promise<SettingsEntry>;
  action(key: string, name: string, args: Record<string, unknown>): Promise<SettingsEntry>;
  listCore?(): Promise<CorePluginSettings[]>;
  patchCore?(
    plugin: string,
    patch: { config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<CorePluginSettings>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const formDeps: SchemaFormDeps = {
  listModels,
  listCatalog: listModels,
  getSecretMeta,
  putSecret,
};

function panelBlock(entry: SettingsEntry, deps: SettingsDeps): HTMLElement {
  const section = el("div", { class: "settings-panel-block" });
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

  const startRefresh = (ms: number): void => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!section.isConnected) return clearInterval(timer);
      const page = section.closest(".settings-section");
      if (page instanceof HTMLElement && page.hidden) return;
      if (document.hidden) return;
      deps
        .refresh(latest.key)
        .then(showBlocks)
        .catch(() => {});
    }, ms);
  };

  const render = (panel: SettingsEntry): void => {
    const form =
      panel.schema === undefined ? undefined : schemaForm(panel.schema, panel.values ?? {}, formDeps);
    const status = el("span", { class: "form-status" });
    const save = el("button", { class: "primary", text: "Save" });
    showBlocks(panel);
    const ms = refreshInterval(panel.refreshMs);
    if (ms !== undefined) startRefresh(ms);
    section.replaceChildren(
      el("h4", { class: "panel-title", text: panel.title }),
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
          render({ ...next, pluginName: panel.pluginName, page: panel.page });
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

function configSection(page: SettingsPage, deps: SettingsDeps): HTMLElement {
  const section = el("section", { class: "settings-section" });
  let current = page;

  const paint = (p: SettingsPage): void => {
    current = p;
    const kids: Node[] = [
      el("h3", {}, p.title, p.plugin === undefined ? "" : el("span", { class: "plugin-id", text: p.plugin })),
    ];
    if (p.description !== undefined) kids.push(el("p", { class: "section-desc", text: p.description }));
    if (p.restartRequired !== undefined) {
      kids.push(el("div", { class: "settings-banner", text: `Restart required: ${p.restartRequired}` }));
    }

    for (const panel of p.panels) kids.push(panelBlock(panel, deps));

    const hasForm = p.schema !== undefined && p.fieldKeys.length > 0;
    const enabledToggle =
      p.plugin !== undefined && p.enabled !== undefined && p.id === p.plugin
        ? (() => {
            const box = el("input", {
              type: "checkbox",
              class: "switch",
              id: `en-${p.id}`,
              "aria-label": "Enabled",
            });
            box.checked = p.enabled !== false;
            return el(
              "div",
              { class: "field toggle" },
              el(
                "div",
                {},
                el("label", { class: "field-label", for: `en-${p.id}`, text: "Enabled" }),
                el("div", {
                  class: "field-desc",
                  text: "Takes effect on the next start.",
                }),
              ),
              box,
            );
          })()
        : undefined;

    if (hasForm || enabledToggle !== undefined) {
      const form = hasForm ? schemaForm(p.schema as Record<string, unknown>, p.values, formDeps) : undefined;
      const status = el("span", { class: "form-status" });
      const save = el("button", { class: "primary", text: "Save" });
      if (enabledToggle !== undefined) kids.push(enabledToggle);
      if (form !== undefined) kids.push(form.node);
      kids.push(el("div", { class: "form-actions" }, status, save));

      save.addEventListener("click", () => {
        if (p.plugin === undefined || deps.patchCore === undefined) return;
        status.className = "form-status";
        status.textContent = "";
        let values: Record<string, unknown> = {};
        try {
          values = form?.read() ?? {};
        } catch (e) {
          status.className = "form-status error";
          status.textContent = errorText(e);
          return;
        }
        const config: Record<string, unknown> = {};
        for (const key of p.fieldKeys) {
          if (Object.hasOwn(values, key)) config[key] = values[key];
          else config[key] = null;
        }
        const enabledBox = enabledToggle?.querySelector("input") as HTMLInputElement | null;
        const patch: { config?: Record<string, unknown>; enabled?: boolean } = {
          ...(p.fieldKeys.length > 0 ? { config } : {}),
          ...(enabledBox !== null && enabledBox !== undefined ? { enabled: enabledBox.checked } : {}),
        };
        save.disabled = true;
        deps
          .patchCore(p.plugin, patch)
          .then((next) => {
            paint({
              ...current,
              values: next.values,
              sources: next.sources,
              enabled: next.enabled,
              restartRequired: next.restartRequired,
              schema: current.schema,
            });
            const s = section.querySelector(".form-status");
            if (s !== null) s.textContent = "Saved";
          })
          .catch((e: unknown) => {
            save.disabled = false;
            status.className = "form-status error";
            status.textContent = errorText(e);
          });
      });
    } else if (p.panels.length === 0) {
      kids.push(el("div", { class: "hint", text: "No settings on this page." }));
    }

    section.replaceChildren(...kids);
  };

  paint(page);
  return section;
}

function builtinSection(page: SettingsPage, deps: SettingsDeps): HTMLElement {
  if (page.kind === "theme") return themeSection();
  const section = el("section", { class: "settings-section" });
  const entry = experimentalEntry();
  const form = schemaForm(entry.schema as Record<string, unknown>, entry.values ?? {});
  const status = el("span", { class: "form-status" });
  const save = el("button", { class: "primary", text: "Save" });
  section.append(
    el("h3", {}, entry.title),
    el("p", { class: "section-desc", text: entry.description ?? "" }),
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
    void deps.save(EXPERIMENTAL_KEY, values);
    status.textContent = "Saved — reload to apply";
  });
  return section;
}

interface Tab {
  label: string;
  panel: HTMLElement;
  group?: string;
}

/** A vertical tab list beside one visible panel at a time, with optional group headings. */
function tabbed(tabs: Tab[]): HTMLElement {
  const bar = el("div", {
    class: "settings-tabs",
    role: "tablist",
    "aria-orientation": "vertical",
    "aria-label": "Settings sections",
  });
  const body = el("div", { class: "settings-panels" });
  const buttons: HTMLButtonElement[] = [];
  let lastGroup: string | undefined;

  tabs.forEach((t, i) => {
    if (t.group !== undefined && t.group !== lastGroup) {
      lastGroup = t.group;
      bar.append(el("div", { class: "settings-group-label", text: t.group }));
    }
    const id = `settings-tab-${i}`;
    const pid = `settings-panel-${i}`;
    t.panel.id = pid;
    t.panel.setAttribute("role", "tabpanel");
    t.panel.setAttribute("aria-labelledby", id);
    body.append(t.panel);
    const b = el("button", {
      class: "settings-tab",
      role: "tab",
      id,
      "aria-controls": pid,
      text: t.label,
    });
    buttons.push(b);
    bar.append(b);
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
  });
  select(0);
  return el("div", { class: "settings-tabbed" }, bar, body);
}

/** Saves the Experimental panel in this browser; everything else goes to the server. */
const withLocalPanels = (deps: SettingsDeps): SettingsDeps => ({
  ...deps,
  save: (key, values) =>
    key === EXPERIMENTAL_KEY ? Promise.resolve(saveExperimental(values)) : deps.save(key, values),
  listCore: deps.listCore ?? listCoreSettings,
  patchCore: deps.patchCore ?? patchCoreSettings,
});

function builtinPages(): SettingsPage[] {
  return [
    {
      id: "ui-theme",
      title: "Theme",
      group: "system",
      order: 900,
      kind: "theme",
      values: {},
      sources: {},
      fieldKeys: [],
      panels: [],
    },
    {
      id: "ui-experimental",
      title: "Experimental",
      group: "system",
      order: 901,
      kind: "experimental",
      values: {},
      sources: {},
      fieldKeys: [],
      panels: [],
    },
  ];
}

function pagePanel(page: SettingsPage, deps: SettingsDeps): HTMLElement {
  if (page.kind === "theme" || page.kind === "experimental") return builtinSection(page, deps);
  return configSection(page, deps);
}

/** Opens the settings dialog: core configSchema pages grouped by x-group, plus Theme / Experimental. */
export function openSettings(serverDeps: SettingsDeps): void {
  const deps = withLocalPanels(serverDeps);
  if (document.querySelector(".modal-backdrop:not(.leaving)") !== null) return;
  const opener = document.activeElement as HTMLElement | null;
  const close = iconButton("close", "Close");
  const content = el(
    "div",
    { class: "modal-body" },
    tabbed(
      builtinPages().map((p) => ({
        label: p.title,
        group: GROUP_LABEL[p.group],
        panel: pagePanel(p, deps),
      })),
    ),
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

  Promise.all([deps.listCore?.() ?? listCoreSettings(), deps.load()])
    .then(([core, panels]) => {
      const pages = [...buildSettingsPages(core, panels), ...builtinPages()];
      const tabs = groupPages(pages).flatMap(({ group, pages: list }) =>
        list.map((p) => ({
          label: p.title,
          group: GROUP_LABEL[group],
          panel: pagePanel(p, deps),
        })),
      );
      content.replaceChildren(tabbed(tabs));
    })
    .catch((e: unknown) =>
      content.append(el("div", { class: "hint error", text: `Settings unavailable: ${errorText(e)}` })),
    );
}
