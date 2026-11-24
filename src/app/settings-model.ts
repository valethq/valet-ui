import type {
  Args,
  Cond,
  CorePluginSettings,
  DisplayDef,
  InputDef,
  ItemDef,
  OptionDef,
  SettingDef,
  SettingsDoc,
  SubsectionDef,
} from "./types";

/** Input types this UI renders itself; anything else falls back along its base chain (12.1 Fallback). */
export const RENDERED = new Set([
  "bool",
  "number",
  "int",
  "percent",
  "duration",
  "bytes",
  "tokens",
  "range",
  "string",
  "strict_string",
  "text",
  "code",
  "secret",
  "path",
  "url",
  "color",
  "select",
  "ref",
  "multiselect",
  "tags",
  "group",
  "list",
  "map",
  "variant",
]);

export const DISPLAY_TYPES = new Set([
  "heading",
  "note",
  "divider",
  "link",
  "badge",
  "stat",
  "meter",
  "table",
  "action",
]);

type Recipes = CorePluginSettings["types"];

/** The type this UI renders for `input`, with the presets of every recipe passed on the way. */
export function renderAs(input: InputDef, types: Recipes = {}): { type: string; f: InputDef } {
  let type = input.type;
  const layers: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (!RENDERED.has(type)) {
    const recipe = types?.[type];
    if (recipe === undefined || seen.has(type)) return { type: "string", f: { ...input, type: "string" } };
    seen.add(type);
    const { base, ...fields } = recipe;
    layers.push(fields);
    type = base;
  }
  return { type, f: { ...Object.assign({}, ...layers.reverse()), ...input, type } };
}

export const isSetting = (item: ItemDef): item is SettingDef =>
  "input" in item && typeof item.input === "object";
export const isDisplay = (item: ItemDef): item is DisplayDef => !isSetting(item);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a Path from values; "@" is the enclosing list item or map value. */
export function getPath(root: Record<string, unknown>, path: string, item?: unknown): unknown {
  const [head, ...rest] = path.split(".");
  let v: unknown = head === "@" ? item : root[head ?? ""];
  for (const seg of rest) v = isRecord(v) ? v[seg] : undefined;
  return v;
}

const isSet = (v: unknown) => v !== undefined && v !== null;

/** Same semantics as core: stored text, absent and null are "not set". */
export function evalCond(cond: Cond | undefined, root: Record<string, unknown>, item?: unknown): boolean {
  if (cond === undefined) return true;
  if ("not" in cond) return !evalCond(cond.not, root, item);
  if ("all" in cond) return cond.all.every((c) => evalCond(c, root, item));
  if ("any" in cond) return cond.any.some((c) => evalCond(c, root, item));
  if ("set" in cond) return isSet(getPath(root, cond.set, item));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if ("eq" in cond) {
    const v = getPath(root, cond.eq[0], item);
    return isSet(v) && same(v, cond.eq[1]);
  }
  if ("ne" in cond) {
    const v = getPath(root, cond.ne[0], item);
    return !(isSet(v) && same(v, cond.ne[1]));
  }
  const v = getPath(root, cond.in[0], item);
  return isSet(v) && cond.in[1].some((x) => same(v, x));
}

/** Fills `{ $: path }` args from the current form values. */
export function resolveArgs(args: Args | undefined, root: Record<string, unknown>, item?: unknown): Args {
  const out: Args = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = isRecord(v) && typeof v.$ === "string" ? getPath(root, v.$, item) : v;
  }
  return out;
}

/** "name" names the doc's own plugin; "<pluginId>/name" another one. */
export function sourceRef(from: string, ownPlugin: string): { plugin: string; name: string } {
  const slash = from.indexOf("/");
  return slash < 0
    ? { plugin: ownPlugin, name: from }
    : { plugin: from.slice(0, slash), name: from.slice(slash + 1) };
}

/** Static options, or undefined when they come from a source. */
export const staticOptions = (f: InputDef): OptionDef[] | undefined =>
  Array.isArray(f.options) ? (f.options as OptionDef[]) : undefined;

/** A deprecated setting shows only while some layer still stores it. */
export function shown(s: SettingDef, layers: CorePluginSettings["layers"] = {}): boolean {
  if (s.deprecated === undefined) return true;
  return [layers.file, layers.user, layers.project].some((l) => l !== undefined && Object.hasOwn(l, s.id));
}

const propInput = (p: Record<string, unknown>): InputDef => {
  const base = { ...(p.default === undefined ? {} : { default: p.default }) };
  if (Array.isArray(p.enum))
    return { type: "select", options: p.enum.map((v) => ({ value: String(v) })), ...base };
  switch (p.type) {
    case "boolean":
      return { type: "bool", ...base };
    case "integer":
      return { type: "int", ...base };
    case "number":
      return { type: "number", ...base };
    case "string":
      return { type: "string", ...base };
    case "array":
      return isRecord(p.items) && p.items.type === "string"
        ? { type: "tags", ...base }
        : { type: "code", language: "json", json: true, ...base };
    default:
      return { type: "code", language: "json", json: true, ...base };
  }
};

/** A plain generated form for a plugin that ships a raw configSchema (12.1): one subsection, one setting per property. */
export function docFromSchema(
  schema: Record<string, unknown>,
  group: "system" | "inference" | "tools",
): SettingsDoc {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const items: SettingDef[] = Object.entries(props)
    .filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]))
    .map(([id, p]) => ({
      id,
      label: typeof p.title === "string" ? p.title : id,
      ...(typeof p.description === "string" ? { summary: p.description } : {}),
      input: propInput(p),
    }));
  return { sections: { [group]: { subsections: [{ id: "general", label: "General", items }] } } };
}

/** Without a doc: inference providers under inference, tool-only plugins under tools, the rest under system. */
export function deriveGroup(provides: string[]): "system" | "inference" | "tools" {
  if (provides.some((p) => p.startsWith("inference@"))) return "inference";
  const substantive = provides.filter((p) => !p.startsWith("settings@"));
  if (substantive.length > 0 && substantive.every((p) => p.startsWith("tools@"))) return "tools";
  return "system";
}

/** The PATCH config for a save: only touched keys, a group sent whole, unset as null (reset to inherited). */
export function patchFor(touched: Iterable<string>, read: (id: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of touched) {
    const v = read(id);
    out[id] = v === undefined ? null : v;
  }
  return out;
}

/** "${secret:name}" -> "name"; anything else -> undefined. */
export function secretNameOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return /^\$\{secret:([A-Za-z0-9][A-Za-z0-9._-]*)\}$/.exec(v)?.[1];
}

/** Paste's default secret name: `<pluginId>.<settingId>`, suffixed by its position inside a group, list or map. */
export const pasteName = (plugin: string, path: string): string =>
  `${plugin}.${path}`.replace(/\["?([^"\]]+)"?\]/g, ".$1").replace(/[^A-Za-z0-9._-]/g, "_");

const UNIT: Record<string, string> = { duration: "ms", bytes: "bytes", tokens: "tokens" };

/** How a stored number shows in its field: unit strings stay as typed; numbers get the type's unit. */
export function unitHint(type: string): string | undefined {
  return UNIT[type];
}

/** Every setting in a doc, in order. */
export function settingsOf(doc: SettingsDoc | undefined): SettingDef[] {
  return Object.values(doc?.sections ?? {}).flatMap((s) =>
    (s?.subsections ?? []).flatMap((ss) => ss.items.filter(isSetting)),
  );
}

/** Controls that need the row's full width sit under their label; the rest sit beside it. */
const WIDE = new Set(["list", "map", "group", "variant", "code", "text", "tags", "multiselect", "secret"]);

export function stacksBelow(input: InputDef, types: Recipes = {}): boolean {
  const { type, f } = renderAs(input, types);
  if (WIDE.has(type)) return true;
  const options = staticOptions(f);
  return (f.style === "segmented" || f.style === "cards") && options !== undefined && options.length > 3;
}

/**
 * A page's subsections split into what shows on the page and what goes under its one Advanced
 * disclosure. A subsection left with nothing in either part is dropped from it.
 */
export function splitAdvanced(subs: SubsectionDef[]): { main: SubsectionDef[]; advanced: SubsectionDef[] } {
  const isAdvanced = (item: ItemDef): boolean => isSetting(item) && item.advanced === true;
  const part = (keep: (item: ItemDef) => boolean) =>
    subs.map((sub) => ({ ...sub, items: sub.items.filter(keep) })).filter((sub) => sub.items.length > 0);
  return { main: part((i) => !isAdvanced(i)), advanced: part(isAdvanced) };
}
