import type { CorePluginSettings, SettingsEntry, SettingsGroup } from "../types";

type Prop = Record<string, unknown>;

export interface SettingsPageInfo {
  title: string;
  description?: string;
  group?: SettingsGroup;
  icon?: string;
  order?: number;
}

/** One tab in the settings UI: a plugin page, an x-pages split, or a built-in. */
export interface SettingsPage {
  id: string;
  title: string;
  description?: string;
  group: SettingsGroup;
  order: number;
  icon?: string;
  kind: "config" | "theme" | "experimental";
  plugin?: string;
  /** Filtered configSchema for this page (properties only). */
  schema?: Record<string, unknown>;
  values: Record<string, unknown>;
  sources: Record<string, "default" | "file" | "settings">;
  enabled?: boolean;
  restartRequired?: string;
  /** Top-level keys this page edits (for PATCH). */
  fieldKeys: string[];
  panels: SettingsEntry[];
}

export const GROUP_ORDER: SettingsGroup[] = ["system", "inference", "tools"];

export const GROUP_LABEL: Record<SettingsGroup, string> = {
  system: "System",
  inference: "Models",
  tools: "Tools",
};

/** First few page titles for a group row; ellipsis when there are more than three. */
export function groupSubtitle(titles: string[]): string {
  const clean = titles.map((t) => t.trim()).filter((t) => t !== "");
  if (clean.length === 0) return "";
  if (clean.length <= 3) return clean.join(", ");
  return `${clean.slice(0, 3).join(", ")}…`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Without `x-group`: inference → inference, tool-only → tools, else system. */
export function deriveGroup(provides: string[], schema?: Record<string, unknown>): SettingsGroup {
  const hinted = schema?.["x-group"];
  if (hinted === "system" || hinted === "inference" || hinted === "tools") return hinted;
  if (provides.some((p) => p.startsWith("inference@"))) return "inference";
  const substantive = provides.filter((p) => !p.startsWith("settings@"));
  if (substantive.length > 0 && substantive.every((p) => p.startsWith("tools@"))) return "tools";
  return "system";
}

/** Top-level properties for `pageId` (null = main page: no `x-page`). */
export function propertiesForPage(
  schema: Record<string, unknown> | undefined,
  pageId: string | null,
): Record<string, Prop> {
  if (!isRecord(schema?.properties)) return {};
  const out: Record<string, Prop> = {};
  for (const [key, raw] of Object.entries(schema.properties)) {
    if (!isRecord(raw)) continue;
    const xp = raw["x-page"];
    if (pageId === null) {
      if (typeof xp !== "string") out[key] = raw;
    } else if (xp === pageId) out[key] = raw;
  }
  return out;
}

function pageInfoOf(raw: unknown): SettingsPageInfo | undefined {
  if (!isRecord(raw) || typeof raw.title !== "string") return undefined;
  const group = raw.group;
  return {
    title: raw.title,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(group === "system" || group === "inference" || group === "tools" ? { group } : {}),
    ...(typeof raw.icon === "string" ? { icon: raw.icon } : {}),
    ...(typeof raw.order === "number" ? { order: raw.order } : {}),
  };
}

function xPages(schema: Record<string, unknown> | undefined): Record<string, SettingsPageInfo> {
  const raw = schema?.["x-pages"];
  if (!isRecord(raw)) return {};
  const out: Record<string, SettingsPageInfo> = {};
  for (const [id, info] of Object.entries(raw)) {
    const parsed = pageInfoOf(info);
    if (parsed !== undefined) out[id] = parsed;
  }
  return out;
}

function schemaSlice(
  schema: Record<string, unknown> | undefined,
  props: Record<string, Prop>,
): Record<string, unknown> | undefined {
  if (schema === undefined || Object.keys(props).length === 0) return undefined;
  return { ...schema, properties: props };
}

/**
 * Builds the settings tab list from core PluginSettings + settings@1 panels.
 * Built-ins (Theme, Experimental) are added by the caller.
 */
export function buildSettingsPages(plugins: CorePluginSettings[], panels: SettingsEntry[]): SettingsPage[] {
  const pages: SettingsPage[] = [];
  const byId = new Map<string, SettingsPage>();

  for (const p of plugins) {
    const schema = p.schema;
    const extras = xPages(schema);
    const hasSchema = schema !== undefined;
    const pluginPanels = panels.filter((e) => e.plugin === p.plugin);
    if (!hasSchema && pluginPanels.length === 0) continue;

    const mainGroup = deriveGroup(p.provides ?? [], schema);
    const mainOrder = typeof schema?.["x-order"] === "number" ? schema["x-order"] : 100;
    const mainIcon = typeof schema?.["x-icon"] === "string" ? schema["x-icon"] : undefined;
    const mainProps = propertiesForPage(schema, null);
    const main: SettingsPage = {
      id: p.plugin,
      title: p.name ?? p.plugin,
      ...(typeof p.description === "string" ? { description: p.description } : {}),
      group: mainGroup,
      order: mainOrder,
      ...(mainIcon === undefined ? {} : { icon: mainIcon }),
      kind: "config",
      plugin: p.plugin,
      schema: schemaSlice(schema, mainProps),
      values: p.values ?? {},
      sources: p.sources ?? {},
      enabled: p.enabled,
      ...(p.restartRequired === undefined ? {} : { restartRequired: p.restartRequired }),
      fieldKeys: Object.keys(mainProps),
      panels: [],
    };
    // Keep a main page when it has fields, no x-pages, or panels that land on it.
    const keepMain =
      main.fieldKeys.length > 0 || Object.keys(extras).length === 0 || pluginPanels.some((e) => !e.page);
    if (keepMain) {
      pages.push(main);
      byId.set(main.id, main);
    }

    for (const [pageId, info] of Object.entries(extras)) {
      const props = propertiesForPage(schema, pageId);
      const page: SettingsPage = {
        id: `${p.plugin}:${pageId}`,
        title: info.title,
        ...(info.description === undefined ? {} : { description: info.description }),
        group: info.group ?? mainGroup,
        order: info.order ?? mainOrder,
        ...(info.icon === undefined ? {} : { icon: info.icon }),
        kind: "config",
        plugin: p.plugin,
        schema: schemaSlice(schema, props),
        values: p.values ?? {},
        sources: p.sources ?? {},
        enabled: p.enabled,
        ...(p.restartRequired === undefined ? {} : { restartRequired: p.restartRequired }),
        fieldKeys: Object.keys(props),
        panels: [],
      };
      pages.push(page);
      byId.set(page.id, page);
      byId.set(`${p.plugin}#${pageId}`, page);
    }
  }

  for (const panel of panels) {
    const target =
      panel.page !== undefined
        ? (byId.get(`${panel.plugin}:${panel.page}`) ?? byId.get(`${panel.plugin}#${panel.page}`))
        : byId.get(panel.plugin);
    if (target !== undefined) {
      target.panels.push(panel);
      continue;
    }
    // Panel for a plugin with no configSchema: synthesize a system page.
    const page: SettingsPage = {
      id: panel.plugin,
      title: panel.pluginName ?? panel.plugin,
      group: "system",
      order: 200,
      kind: "config",
      plugin: panel.plugin,
      values: {},
      sources: {},
      fieldKeys: [],
      panels: [panel],
    };
    pages.push(page);
    byId.set(page.id, page);
  }

  return pages;
}

/** Group headings with pages sorted by order, then title. */
export function groupPages(pages: SettingsPage[]): { group: SettingsGroup; pages: SettingsPage[] }[] {
  const buckets = new Map<SettingsGroup, SettingsPage[]>();
  for (const g of GROUP_ORDER) buckets.set(g, []);
  for (const p of pages) (buckets.get(p.group) ?? buckets.get("system"))?.push(p);
  for (const list of buckets.values()) {
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }
  return GROUP_ORDER.map((group) => ({ group, pages: buckets.get(group) ?? [] })).filter(
    (g) => g.pages.length > 0,
  );
}
