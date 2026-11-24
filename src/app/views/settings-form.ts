import { ApiError } from "../api";
import { el } from "../dom";
import { iconButton, selectChip } from "../icons";
import {
  evalCond,
  isSetting,
  patchFor,
  resolveArgs,
  shown,
  sourceRef,
  splitAdvanced,
  stacksBelow,
} from "../settings-model";
import type {
  Args,
  ContributionView,
  CorePluginSettings,
  DisplayDef,
  ItemDef,
  OptionDef,
  ProviderModels,
  RuntimeView,
  SecretMeta,
  SettingDef,
} from "../types";
import { cleanDisplay, displayNode, refreshInterval, renderDisplays } from "./displays";
import { modelsTable } from "./models-table";
import { type Control, type InputEnv, inputControl, nextId } from "./settings-inputs";
import type { SettingsPage } from "./settings-pages";

export interface FormDeps {
  getCore(plugin: string, project?: string): Promise<CorePluginSettings>;
  patchCore(
    plugin: string,
    patch: {
      scope?: "user" | "project";
      project?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
  ): Promise<CorePluginSettings>;
  listProjects(): Promise<{ id: string; name: string }[]>;
  options(plugin: string, name: string, args: Args): Promise<OptionDef[]>;
  view(plugin: string, name: string, args: Args): Promise<Record<string, unknown> | null>;
  action(plugin: string, name: string, args: Args): Promise<ContributionView>;
  saveRuntime(plugin: string, id: string, values: Record<string, unknown>): Promise<ContributionView>;
  refreshRuntime(plugin: string): Promise<ContributionView>;
  listSecrets(): Promise<SecretMeta[]>;
  putSecret(name: string, value: string): Promise<SecretMeta>;
  listCatalog(): Promise<ProviderModels[]>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The hand-written models table stays for valet-agent's model list (12.1). */
const isModelsTable = (plugin: string | undefined, s: SettingDef) =>
  plugin === "valet-agent" && s.id === "models";

interface Field {
  setting: SettingDef;
  ctl: Control;
  wrap: HTMLElement;
  error: HTMLElement;
  touched: boolean;
  reset: boolean;
}

/** A display item, with `from` view fields fetched and merged over the static ones. */
function displayWith(
  def: DisplayDef,
  owner: string,
  deps: FormDeps,
  root: () => Record<string, unknown>,
  run: (action: string, args: Args) => Promise<void>,
  item?: unknown,
): HTMLElement {
  const node = el("div", { class: "display-slot" });
  const paint = (d: Record<string, unknown>) => node.replaceChildren(displayNode(cleanDisplay(d), { run }));
  if (typeof def.from !== "string") {
    paint(def);
    return node;
  }
  const { plugin, name } = sourceRef(def.from, owner);
  void deps
    .view(plugin, name, resolveArgs(def.args, root(), item))
    .then((fields) => paint({ ...def, ...(fields ?? {}) }))
    .catch((e: unknown) => paint({ type: "note", text: `Couldn't load: ${errorText(e)}`, tone: "warning" }));
  return node;
}

/** One runtime (settings@2) subsection: displays, and a form when the plugin takes values. */
function runtimeNode(
  rs: RuntimeView,
  plugin: string,
  deps: FormDeps,
  update: (c: ContributionView) => void,
): HTMLElement {
  const run = async (action: string, args: Args) => update(await deps.action(plugin, action, args));
  const values = rs.values ?? {};
  const fields: { id: string; ctl: Control }[] = [];
  const env: InputEnv = {
    types: {},
    root: () => values,
    options: (from, args) => {
      const ref = sourceRef(from, plugin);
      return deps.options(ref.plugin, ref.name, args);
    },
    listSecrets: deps.listSecrets,
    putSecret: deps.putSecret,
    display: (d) => displayWith(d, plugin, deps, () => values, run),
    changed() {},
    plugin,
  };
  const body: HTMLElement[] = [];
  const pendingDisplays: unknown[] = [];
  const flush = () => {
    if (pendingDisplays.length > 0) body.push(...renderDisplays(pendingDisplays.splice(0), { run }));
  };
  for (const item of rs.items) {
    if (!isSetting(item)) {
      if (!evalCond(item.when, values)) continue;
      if (typeof (item as DisplayDef).from === "string") {
        flush();
        body.push(env.display(item as DisplayDef));
      } else pendingDisplays.push(item);
      continue;
    }
    flush();
    const id = nextId();
    const ctl = inputControl(item.input, values[item.id], env, id, `${plugin}.${item.id}`);
    fields.push({ id: item.id, ctl });
    body.push(
      el(
        "div",
        { class: "field" },
        el("label", { class: "field-label", for: id, text: item.label }),
        ...(item.summary === undefined ? [] : [el("div", { class: "field-desc", text: item.summary })]),
        ctl.node,
      ),
    );
  }
  flush();
  const list = el("div", { class: "set-list runtime" }, el("div", { class: "blocks" }, ...body));
  const node = sectionNode(rs.label, rs.summary, list);
  if (rs.editable && fields.length > 0) {
    const status = el("span", { class: "form-status" });
    const save = el("button", { class: "primary", text: "Save" });
    save.addEventListener("click", () => {
      status.className = "form-status";
      status.textContent = "";
      const out: Record<string, unknown> = {};
      try {
        for (const f of fields) {
          const v = f.ctl.read();
          if (v !== undefined) out[f.id] = v;
        }
      } catch (e) {
        status.className = "form-status error";
        status.textContent = errorText(e);
        return;
      }
      save.disabled = true;
      deps
        .saveRuntime(plugin, rs.id, out)
        .then((c) => {
          update(c);
          status.textContent = "Saved";
        })
        .catch((e: unknown) => {
          status.className = "form-status error";
          status.textContent = errorText(e);
        })
        .finally(() => {
          save.disabled = false;
        });
    });
    list.append(el("div", { class: "form-actions" }, status, save));
  }
  return node;
}

/** A titled group of settings: a heading (omitted when null) over one panel. */
function sectionNode(label: string | null, summary: string | undefined, list: HTMLElement): HTMLElement {
  return el(
    "section",
    { class: "set-sec" },
    ...(label === null ? [] : [el("h4", { class: "set-sec-title", text: label })]),
    ...(label === null || summary === undefined ? [] : [el("p", { class: "set-sec-desc", text: summary })]),
    list,
  );
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many.replace("#", String(n));

/**
 * A plugin's settings page: a header with the Enabled switch, one panel of rows per subsection, runtime
 * subsections, every advanced setting under one disclosure, and a save bar that shows while anything changed.
 */
export function configPage(page: SettingsPage, deps: FormDeps): HTMLElement {
  const section = el("section", { class: "settings-section" });
  const plugin = page.plugin ?? page.id;
  let core = page.core;
  let runtime = page.runtime;
  let project: string | undefined;
  let projects: { id: string; name: string }[] | undefined;
  let advancedOpen = false;
  const runtimeSlots = new Map<string, HTMLElement>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const pageSettings = () => page.subsections.flatMap((s) => s.items.filter(isSetting));
  const projectCapable = () => pageSettings().some((s) => s.scopes?.includes("project"));

  const updateRuntime = (c: ContributionView) => {
    runtime = c.subsections.filter((r) => page.runtime.some((p) => p.id === r.id));
    for (const rs of runtime) {
      const slot = runtimeSlots.get(rs.id);
      slot?.replaceChildren(runtimeNode(rs, plugin, deps, updateRuntime));
    }
  };

  const startRefresh = () => {
    clearInterval(timer);
    const ms = Math.min(...runtime.map((r) => refreshInterval(r.refreshMs) ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(ms)) return;
    timer = setInterval(() => {
      if (!section.isConnected) return clearInterval(timer);
      const host = section.closest(".settings-section, [role=tabpanel]");
      if ((host instanceof HTMLElement && host.hidden) || section.hidden || document.hidden) return;
      deps
        .refreshRuntime(plugin)
        .then(updateRuntime)
        .catch(() => {});
    }, ms);
  };

  const paint = (saved = false): void => {
    const fields = new Map<string, Field>();
    const layer = (project === undefined ? core?.layers?.user : core?.layers?.project) ?? {};
    const effective = core?.values ?? {};
    const types = core?.types ?? {};
    const root = (): Record<string, unknown> => {
      const out = { ...effective };
      for (const [id, f] of fields) {
        if (!f.touched) continue;
        try {
          const v = f.reset ? undefined : f.ctl.read();
          if (v === undefined) delete out[id];
          else out[id] = v;
        } catch {
          // Unreadable input: conditions keep the last good value.
        }
      }
      return out;
    };
    const lists: HTMLElement[] = [];
    const refresh = () => {
      const values = root();
      for (const f of fields.values()) {
        f.wrap.hidden = !evalCond(f.setting.when, values) || !shown(f.setting, core?.layers);
        f.ctl.refresh();
      }
      // A panel whose rows are all hidden by their conditions hides with its heading.
      for (const list of lists) {
        const sec = list.closest<HTMLElement>(".set-sec");
        if (sec !== null) sec.hidden = list.querySelector(":scope > .set-row:not([hidden])") === null;
      }
    };
    const run = async (action: string, args: Args) => updateRuntime(await deps.action(plugin, action, args));
    const env: InputEnv = {
      types,
      root,
      options: (from, args) => {
        const ref = sourceRef(from, plugin);
        return deps.options(ref.plugin, ref.name, args);
      },
      listSecrets: deps.listSecrets,
      putSecret: deps.putSecret,
      display: (d, item) => displayWith(d, plugin, deps, root, run, item),
      changed: () => refresh(),
      plugin,
    };

    const enabledBox =
      page.primary && core !== undefined && project === undefined
        ? el("input", { type: "checkbox", class: "switch", id: `en-${page.id}`, "aria-label": "Enabled" })
        : undefined;
    if (enabledBox !== undefined) enabledBox.checked = core?.enabled !== false;
    const enabledChanged = () => enabledBox !== undefined && enabledBox.checked !== (core?.enabled !== false);

    const barText = el("span", { class: "set-bar-text" });
    const discard = el("button", { class: "set-discard", type: "button", text: "Discard" });
    const save = el("button", { class: "primary", type: "button", text: "Save changes" });
    const bar = el("div", { class: "set-bar", role: "status" }, barText, discard, save);
    const pending = (): number =>
      [...fields.values()].filter((f) => f.touched).length + (enabledChanged() ? 1 : 0);
    const syncBar = (message?: { text: string; error?: boolean }): void => {
      const n = pending();
      const on = n > 0 || message !== undefined;
      bar.classList.toggle("on", on);
      bar.classList.toggle("error", message?.error === true);
      section.classList.toggle("has-bar", on);
      barText.textContent = message?.text ?? plural(n, "1 unsaved change", "# unsaved changes");
      discard.hidden = save.hidden = n === 0;
    };

    const fieldNode = (s: SettingDef): HTMLElement => {
      const stored = Object.hasOwn(layer, s.id);
      const value = stored ? layer[s.id] : effective[s.id];
      const id = nextId();
      const projectLocked = project !== undefined && !s.scopes?.includes("project");
      const models = isModelsTable(page.plugin, s);
      let ctl: Control;
      if (models) {
        const table = modelsTable(value, deps.listCatalog);
        ctl = { node: table.node, read: () => table.read(), refresh() {} };
      } else ctl = inputControl(s.input, value, env, id, s.id);
      const isToggle = ctl.node instanceof HTMLInputElement && ctl.node.type === "checkbox";
      const error = el("div", { class: "set-note error" });
      error.hidden = true;
      const resetNote = el("div", { class: "set-note", text: "Goes back to the default when you save" });
      resetNote.hidden = true;
      const dot = el("span", {
        class: "set-dot",
        title: project === undefined ? "Changed from the default" : "Set for this project",
      });
      const reset = iconButton(
        "undo",
        project === undefined ? `Reset ${s.label} to the default` : `Use your setting for ${s.label}`,
        "set-reset",
      );
      reset.type = "button";
      const marks = (on: boolean) => {
        dot.hidden = !on;
        reset.hidden = !on || !stored || projectLocked;
      };
      marks(stored);
      const issue = core?.issues?.[s.id];
      const notes = [
        ...(s.details === undefined
          ? []
          : [
              el(
                "details",
                { class: "field-details" },
                el("summary", { text: "More" }),
                el("div", { class: "set-desc", text: s.details }),
              ),
            ]),
        ...(s.deprecated === undefined
          ? []
          : [el("div", { class: "set-note warning", text: `Deprecated: ${s.deprecated}` })]),
        ...(issue === undefined ? [] : [el("div", { class: "set-note warning", text: issue })]),
        ...(s.apply === "restart" && core?.liveConfig !== false
          ? [el("div", { class: "set-note", text: "Applies after a restart" })]
          : []),
        ...(projectLocked ? [el("div", { class: "set-note", text: "Not per project" })] : []),
        resetNote,
        error,
      ];
      const stack = models || stacksBelow(s.input, types);
      const wrap = el(
        "div",
        { class: `set-row${stack ? " stack" : ""}${isToggle ? " toggle" : ""}` },
        el(
          "div",
          { class: "set-text" },
          el(
            "div",
            { class: "set-title" },
            el("label", {
              class: "set-label",
              for: id,
              text: s.label + (s.input.required === true ? " *" : ""),
            }),
            dot,
            reset,
          ),
          ...(s.summary === undefined ? [] : [el("p", { class: "set-desc", text: s.summary })]),
          ...notes,
        ),
        el("div", { class: "set-ctl" }, ctl.node),
      );
      if (projectLocked) {
        wrap.classList.add("locked");
        for (const c of wrap.querySelectorAll(".set-ctl :is(input, select, textarea, button)"))
          (c as HTMLInputElement).disabled = true;
      }
      const field: Field = { setting: s, ctl, wrap, error, touched: false, reset: false };
      const touch = () => {
        field.touched = true;
        field.reset = false;
        resetNote.hidden = true;
        marks(true);
        syncBar();
      };
      const ctlBox = wrap.lastElementChild as HTMLElement;
      ctlBox.addEventListener("input", touch);
      ctlBox.addEventListener("change", touch);
      ctlBox.addEventListener("click", (ev) => {
        if ((ev.target as Element).closest("button") !== null) touch();
      });
      reset.addEventListener("click", () => {
        field.touched = true;
        field.reset = true;
        marks(false);
        resetNote.hidden = false;
        refresh();
        syncBar();
      });
      fields.set(s.id, field);
      return wrap;
    };

    const listOf = (items: ItemDef[]): HTMLElement => {
      const list = el(
        "div",
        { class: "set-list" },
        ...items.map((item) =>
          isSetting(item)
            ? fieldNode(item)
            : el("div", { class: "set-row display" }, env.display(item as DisplayDef)),
        ),
      );
      lists.push(list);
      return list;
    };

    const head = el(
      "div",
      { class: "set-head" },
      el(
        "div",
        { class: "set-head-text" },
        el("h3", {}, page.title, el("span", { class: "plugin-id", text: plugin })),
        ...(page.primary && page.description !== undefined
          ? [el("p", { class: "set-head-desc", text: page.description })]
          : []),
        ...(core?.liveConfig === false
          ? [el("p", { class: "set-note", text: "Changes apply after a restart" })]
          : []),
      ),
    );
    if (enabledBox !== undefined) {
      const hint = el("span", { class: "set-enabled-hint", text: "After a restart" });
      const sync = () => {
        hint.hidden = !enabledChanged();
      };
      sync();
      enabledBox.addEventListener("change", () => {
        sync();
        syncBar();
      });
      head.append(
        el(
          "div",
          { class: "set-enabled" },
          hint,
          el("label", { for: enabledBox.id, text: "Enabled" }),
          enabledBox,
        ),
      );
    }
    const kids: Node[] = [head];
    if (core?.restartRequired !== undefined)
      kids.push(el("div", { class: "settings-banner", text: `Restart required: ${core.restartRequired}` }));

    if (projectCapable()) {
      const scope = el("select", { "aria-label": "Settings scope" });
      scope.append(el("option", { value: "", text: "Everywhere (your settings)" }));
      for (const p of projects ?? []) scope.append(el("option", { value: p.id, text: `Project: ${p.name}` }));
      scope.value = project ?? "";
      scope.addEventListener("change", () => {
        const next = scope.value === "" ? undefined : scope.value;
        deps
          .getCore(plugin, next)
          .then((c) => {
            project = next;
            core = c;
            paint();
          })
          .catch(() => {
            scope.value = project ?? "";
          });
      });
      if (projects === undefined)
        void deps.listProjects().then((list) => {
          projects = list;
          for (const p of list) scope.append(el("option", { value: p.id, text: `Project: ${p.name}` }));
        });
      kids.push(
        el(
          "div",
          { class: "set-scope" },
          el("span", { text: "Editing" }),
          selectChip(scope, "set-scope-select"),
        ),
      );
    }

    const { main, advanced } = splitAdvanced(page.subsections);
    type Block = { order: number; node: HTMLElement };
    const blocks: Block[] = [];
    const titled = main.length + runtime.length > 1;
    for (const [i, sub] of main.entries()) {
      blocks.push({
        order: (sub.order ?? 0) + i / 1000,
        node: sectionNode(titled ? sub.label : null, sub.summary, listOf(sub.items)),
      });
    }
    runtimeSlots.clear();
    for (const [i, rs] of runtime.entries()) {
      const slot = el("div", { class: "runtime-slot" }, runtimeNode(rs, plugin, deps, updateRuntime));
      runtimeSlots.set(rs.id, slot);
      blocks.push({ order: (rs.order ?? 0) + i / 1000, node: slot });
    }
    blocks.sort((a, b) => a.order - b.order);
    kids.push(...blocks.map((b) => b.node));

    if (advanced.length > 0) {
      const count = advanced.reduce((n, sub) => n + sub.items.length, 0);
      const details = el(
        "details",
        { class: "set-adv" },
        el("summary", {}, "Advanced", el("span", { class: "set-adv-count", text: String(count) })),
        ...advanced.map((sub) =>
          sectionNode(advanced.length > 1 ? sub.label : null, sub.summary, listOf(sub.items)),
        ),
      );
      details.open = advancedOpen;
      details.addEventListener("toggle", () => {
        advancedOpen = details.open;
      });
      kids.push(details);
    }

    if (fields.size > 0 || enabledBox !== undefined) {
      kids.push(bar);
      discard.addEventListener("click", () => paint());
      save.addEventListener("click", () => {
        for (const f of fields.values()) f.error.hidden = true;
        const touched = [...fields.values()].filter((f) => f.touched).map((f) => f.setting.id);
        let config: Record<string, unknown>;
        try {
          config = patchFor(touched, (id) => {
            const f = fields.get(id) as Field;
            return f.reset ? undefined : f.ctl.read();
          });
        } catch (e) {
          syncBar({ text: errorText(e), error: true });
          return;
        }
        const enabled = enabledChanged();
        if (touched.length === 0 && !enabled) return syncBar();
        save.disabled = discard.disabled = true;
        deps
          .patchCore(plugin, {
            ...(project === undefined ? {} : { scope: "project" as const, project }),
            ...(touched.length > 0 ? { config } : {}),
            ...(enabled ? { enabled: enabledBox?.checked === true } : {}),
          })
          .then((next) => {
            core = next;
            paint(true);
          })
          .catch((e: unknown) => {
            save.disabled = discard.disabled = false;
            syncBar({ text: errorText(e), error: true });
            if (e instanceof ApiError && e.errors !== undefined) {
              for (const [path, msg] of Object.entries(e.errors)) {
                const local = path.includes(":") ? path.slice(path.indexOf(":") + 1) : path;
                const f = fields.get(local.split(/[.[]/)[0] ?? "");
                if (f === undefined) continue;
                f.error.hidden = false;
                f.error.textContent =
                  path === local ? `${local}: ${msg}` : `Project ${path.split(":")[0]}: ${local}: ${msg}`;
              }
            }
          });
      });
    } else if (runtime.length === 0) {
      kids.push(el("div", { class: "hint", text: "No settings on this page" }));
    }

    section.replaceChildren(...kids);
    refresh();
    syncBar(saved ? { text: "Saved" } : undefined);
    if (saved) setTimeout(() => bar.isConnected && pending() === 0 && syncBar(), 1600);
    startRefresh();
  };

  paint();
  return section;
}
