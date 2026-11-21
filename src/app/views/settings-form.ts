import { ApiError } from "../api";
import { el } from "../dom";
import { evalCond, isSetting, patchFor, resolveArgs, shown, sourceRef } from "../settings-model";
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

const SOURCE_TEXT: Record<string, string> = {
  default: "Default",
  file: "From the config file",
  settings: "Saved",
  project: "Set for this project",
};

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
  const node = el(
    "div",
    { class: "settings-panel-block" },
    el("h4", { class: "panel-title", text: rs.label }),
    ...(rs.summary === undefined ? [] : [el("p", { class: "section-desc", text: rs.summary })]),
    el("div", { class: "blocks" }, ...body),
  );
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
    node.append(el("div", { class: "form-actions" }, status, save));
  }
  return node;
}

/** A plugin's settings page: its doc's subsections in one section, runtime subsections, and the Enabled switch. */
export function configPage(page: SettingsPage, deps: FormDeps): HTMLElement {
  const section = el("section", { class: "settings-section" });
  const plugin = page.plugin ?? page.id;
  let core = page.core;
  let runtime = page.runtime;
  let project: string | undefined;
  let projects: { id: string; name: string }[] | undefined;
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

  const paint = (): void => {
    const fields = new Map<string, Field>();
    const layer = (project === undefined ? core?.layers?.user : core?.layers?.project) ?? {};
    const effective = core?.values ?? {};
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
    const refresh = () => {
      const values = root();
      for (const f of fields.values()) {
        f.wrap.hidden = !evalCond(f.setting.when, values) || !shown(f.setting, core?.layers);
        f.ctl.refresh();
      }
    };
    const run = async (action: string, args: Args) => updateRuntime(await deps.action(plugin, action, args));
    const env: InputEnv = {
      types: core?.types ?? {},
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

    const fieldNode = (s: SettingDef): HTMLElement => {
      const stored = Object.hasOwn(layer, s.id);
      const value = stored ? layer[s.id] : effective[s.id];
      const id = nextId();
      const projectLocked = project !== undefined && !s.scopes?.includes("project");
      let ctl: Control;
      if (isModelsTable(page.plugin, s)) {
        const table = modelsTable(value, deps.listCatalog);
        ctl = { node: table.node, read: () => table.read(), refresh() {} };
      } else ctl = inputControl(s.input, value, env, id, s.id);
      const error = el("div", { class: "field-desc error" });
      error.hidden = true;
      const source = core?.sources?.[s.id];
      const meta = el("div", { class: "field-source" });
      const reset = el("button", { type: "button", class: "chip", text: "Reset" });
      const showReset = (on: boolean) => {
        reset.style.display = on ? "" : "none";
      };
      showReset(stored);
      reset.title =
        project === undefined ? "Go back to the file or default value" : "Use the value from your settings";
      const issue = core?.issues?.[s.id];
      const sourceText = stored
        ? project === undefined
          ? "Saved"
          : "Set for this project"
        : source === undefined
          ? "Not set"
          : `Inherited: ${SOURCE_TEXT[source] ?? source}`;
      meta.append(
        el("span", { text: sourceText }),
        ...(s.apply === "restart" || core?.liveConfig === false
          ? [el("span", { class: "hint", text: "Applies after a restart" })]
          : []),
        reset,
      );
      const bool = el("div", {});
      const label = el("label", {
        class: "field-label",
        for: id,
        text: s.label + (s.input.required === true ? " *" : ""),
      });
      const desc = s.summary === undefined ? [] : [el("div", { class: "field-desc", text: s.summary })];
      const details =
        s.details === undefined
          ? []
          : [
              el(
                "details",
                { class: "field-details" },
                el("summary", { text: "More" }),
                el("div", { class: "field-desc", text: s.details }),
              ),
            ];
      const deprecated =
        s.deprecated === undefined
          ? []
          : [el("div", { class: "field-desc warning", text: `Deprecated: ${s.deprecated}` })];
      const issueNode = issue === undefined ? [] : [el("div", { class: "field-desc warning", text: issue })];
      const isToggle = ctl.node instanceof HTMLInputElement && ctl.node.type === "checkbox";
      bool.append(label, ...desc);
      const wrap = isToggle
        ? el("div", { class: `field toggle${stored ? "" : " inherited"}` }, bool, ctl.node)
        : el("div", { class: `field${stored ? "" : " inherited"}` }, label, ...desc, ctl.node);
      (isToggle ? bool : wrap).append(...details, ...deprecated, ...issueNode, meta, error);
      if (projectLocked) {
        wrap.classList.add("locked");
        for (const c of wrap.querySelectorAll("input, select, textarea, button"))
          (c as HTMLInputElement).disabled = true;
        meta.replaceChildren(el("span", { class: "hint", text: "Not per project" }));
      }
      const field: Field = { setting: s, ctl, wrap, error, touched: false, reset: false };
      const touch = () => {
        field.touched = true;
        field.reset = false;
        wrap.classList.remove("inherited");
        showReset(true);
      };
      wrap.addEventListener("input", touch);
      wrap.addEventListener("change", touch);
      wrap.addEventListener("click", (ev) => {
        const b = (ev.target as Element).closest("button");
        if (b !== null && b !== reset && wrap.contains(b)) touch();
      });
      reset.addEventListener("click", () => {
        field.touched = true;
        field.reset = true;
        wrap.classList.add("inherited");
        showReset(false);
        meta.firstElementChild?.replaceWith(el("span", { text: "Resets to the inherited value on save" }));
        refresh();
      });
      fields.set(s.id, field);
      return wrap;
    };

    const itemsNode = (items: ItemDef[]): HTMLElement[] => {
      const main: HTMLElement[] = [];
      const advanced: HTMLElement[] = [];
      for (const item of items) {
        if (isSetting(item)) (item.advanced === true ? advanced : main).push(fieldNode(item));
        else main.push(env.display(item as DisplayDef));
      }
      if (advanced.length === 0) return main;
      const details = el("details", { class: "form-advanced" }, el("summary", { text: "Advanced" }));
      details.append(el("div", { class: "form-advanced-body" }, ...advanced));
      return [...main, details];
    };

    const kids: Node[] = [el("h3", {}, page.title, el("span", { class: "plugin-id", text: plugin }))];
    if (page.primary && page.description !== undefined)
      kids.push(el("p", { class: "section-desc", text: page.description }));
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
        el("div", { class: "field scope" }, el("label", { class: "field-label", text: "Editing" }), scope),
      );
    }

    type Block = { order: number; node: HTMLElement };
    const blocks: Block[] = [];
    const many = page.subsections.length + runtime.length > 1;
    for (const [i, sub] of page.subsections.entries()) {
      const body = itemsNode(sub.items);
      blocks.push({
        order: (sub.order ?? 0) + i / 1000,
        node: el(
          "div",
          { class: "form-section" },
          ...(many ? [el("h4", { class: "form-section-title", text: sub.label })] : []),
          ...(sub.summary === undefined ? [] : [el("p", { class: "section-desc", text: sub.summary })]),
          ...body,
        ),
      });
    }
    runtimeSlots.clear();
    for (const [i, rs] of runtime.entries()) {
      const slot = el("div", { class: "runtime-slot" }, runtimeNode(rs, plugin, deps, updateRuntime));
      runtimeSlots.set(rs.id, slot);
      blocks.push({ order: (rs.order ?? 0) + i / 1000, node: slot });
    }
    blocks.sort((a, b) => a.order - b.order);

    const form = el("div", { class: "form" }, ...blocks.map((b) => b.node));
    kids.push(form);

    const enabledBox =
      page.primary && core !== undefined && project === undefined
        ? el("input", { type: "checkbox", class: "switch", id: `en-${page.id}`, "aria-label": "Enabled" })
        : undefined;
    if (enabledBox !== undefined) {
      enabledBox.checked = core?.enabled !== false;
      kids.push(
        el(
          "div",
          { class: "field toggle" },
          el(
            "div",
            {},
            el("label", { class: "field-label", for: enabledBox.id, text: "Enabled" }),
            el("div", { class: "field-desc", text: "Takes effect after restart." }),
          ),
          enabledBox,
        ),
      );
    }

    if (fields.size > 0 || enabledBox !== undefined) {
      const status = el("span", { class: "form-status" });
      const save = el("button", { class: "primary", text: "Save" });
      kids.push(el("div", { class: "form-actions" }, status, save));
      save.addEventListener("click", () => {
        status.className = "form-status";
        status.textContent = "";
        for (const f of fields.values()) f.error.hidden = true;
        const touched = [...fields.values()].filter((f) => f.touched).map((f) => f.setting.id);
        let config: Record<string, unknown>;
        try {
          config = patchFor(touched, (id) => {
            const f = fields.get(id) as Field;
            return f.reset ? undefined : f.ctl.read();
          });
        } catch (e) {
          status.className = "form-status error";
          status.textContent = errorText(e);
          return;
        }
        const enabledChanged = enabledBox !== undefined && enabledBox.checked !== (core?.enabled !== false);
        if (touched.length === 0 && !enabledChanged) {
          status.textContent = "Nothing to save";
          return;
        }
        save.disabled = true;
        deps
          .patchCore(plugin, {
            ...(project === undefined ? {} : { scope: "project" as const, project }),
            ...(touched.length > 0 ? { config } : {}),
            ...(enabledChanged ? { enabled: enabledBox?.checked === true } : {}),
          })
          .then((next) => {
            core = next;
            paint();
            const s = section.querySelector(".form-status");
            if (s !== null) s.textContent = "Saved";
          })
          .catch((e: unknown) => {
            save.disabled = false;
            status.className = "form-status error";
            status.textContent = errorText(e);
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
    startRefresh();
  };

  paint();
  return section;
}
