import { deriveGroup, docFromSchema } from "../settings-model";
import type {
  ContributionView,
  CorePluginSettings,
  RuntimeView,
  SettingsGroup,
  SubsectionDef,
} from "../types";

/** One page in the settings UI: a plugin in one section, or a built-in. */
export interface SettingsPage {
  id: string;
  title: string;
  description?: string;
  group: SettingsGroup;
  order: number;
  icon?: string;
  kind: "config" | "theme";
  plugin?: string;
  /** The plugin's settings as core serves them; the page edits `subsections` of its doc. */
  core?: CorePluginSettings;
  subsections: SubsectionDef[];
  runtime: RuntimeView[];
  /** The plugin's settings@2 contribution, for option/view/action calls. */
  contribution?: ContributionView;
  /** Only the plugin's first page carries the Enabled switch. */
  primary: boolean;
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

const byOrder = <T extends { order?: number }>(list: T[]): T[] =>
  list
    .map((x, i) => [x, i] as const)
    .sort(([a, i], [b, j]) => (a.order ?? 0) - (b.order ?? 0) || i - j)
    .map(([x]) => x);

/** Pages from core's PluginSettings (v3 docs, or a generated form for raw schemas) plus settings@2 runtime subsections. */
export function buildSettingsPages(
  plugins: CorePluginSettings[],
  contributions: ContributionView[],
): SettingsPage[] {
  const pages: SettingsPage[] = [];
  const byPlugin = new Map(contributions.map((c) => [c.plugin, c]));
  const seen = new Set<string>();

  for (const p of plugins) {
    seen.add(p.plugin);
    const contribution = byPlugin.get(p.plugin);
    const fallback = deriveGroup(p.provides ?? []);
    const doc = p.settings ?? (p.schema === undefined ? undefined : docFromSchema(p.schema, fallback));
    const sections = Object.entries(doc?.sections ?? {}) as [
      SettingsGroup,
      NonNullable<typeof doc>["sections"][SettingsGroup],
    ][];
    const runtime = contribution?.subsections ?? [];
    if (sections.length === 0 && runtime.length === 0) continue;
    const first: SettingsGroup = sections[0]?.[0] ?? fallback;
    const names = sections.length > 0 ? sections.map(([g]) => g) : [first];
    for (const group of names) {
      const sec = sections.find(([g]) => g === group)?.[1];
      const subs = sec?.subsections ?? [];
      pages.push({
        id: group === first ? p.plugin : `${p.plugin}:${group}`,
        title: group !== first && subs.length === 1 ? (subs[0]?.label ?? p.plugin) : (p.name ?? p.plugin),
        ...(p.description === undefined ? {} : { description: p.description }),
        group,
        order: sec?.order ?? 100,
        ...(sec?.icon === undefined ? {} : { icon: sec.icon }),
        kind: "config",
        plugin: p.plugin,
        core: p,
        subsections: byOrder(subs),
        runtime: byOrder(runtime.filter((r) => (r.section ?? first) === group)),
        ...(contribution === undefined ? {} : { contribution }),
        primary: group === first,
      });
    }
  }

  // A contribution from a plugin core didn't list (no manifest settings) still gets a system page.
  for (const c of contributions) {
    if (seen.has(c.plugin) || c.subsections.length === 0) continue;
    pages.push({
      id: c.plugin,
      title: c.plugin,
      group: "system",
      order: 200,
      kind: "config",
      plugin: c.plugin,
      subsections: [],
      runtime: byOrder(c.subsections),
      contribution: c,
      primary: false,
    });
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
