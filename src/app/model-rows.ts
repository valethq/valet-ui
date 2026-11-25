import type { ModelInfo, ProviderModels } from "./types";

/** One row written to the agent provider's `models` config. */
export interface CatalogRow {
  provider: string;
  id: string;
  show?: boolean;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  efforts?: string[];
  defaultEffort?: string;
  fast?: boolean;
  custom?: boolean;
}

/** The parts of a model the list can edit. */
export interface ModelFields {
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  efforts: string[];
  defaultEffort?: string;
  fast: boolean;
}

export interface ModelEntry {
  provider: string;
  id: string;
  custom: boolean;
  show: boolean;
  /** Whether it shows when it has no row of its own. */
  defaultShow: boolean;
  /** What the provider lists; absent for custom models. */
  base?: ModelFields;
  fields: ModelFields;
}

export const CUSTOM_FIELDS: Omit<ModelFields, "name"> = {
  contextWindow: 128_000,
  maxOutputTokens: 32_000,
  efforts: [],
  fast: false,
};

const KEYS = ["name", "contextWindow", "maxOutputTokens", "efforts", "defaultEffort", "fast"] as const;

const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** Effort levels in their usual order, unknown ones last. */
export function sortLevels(levels: Iterable<string>): string[] {
  const rank = (l: string) => {
    const i = LEVELS.indexOf(l);
    return i < 0 ? LEVELS.length : i;
  };
  return [...new Set(levels)].sort((a, b) => rank(a) - rank(b));
}

const fieldsOf = (m: ModelInfo): ModelFields => ({
  name: m.name,
  ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
  ...(m.maxOutputTokens === undefined ? {} : { maxOutputTokens: m.maxOutputTokens }),
  efforts: m.efforts ?? [],
  ...(m.defaultEffort === undefined ? {} : { defaultEffort: m.defaultEffort }),
  fast: m.fast === true,
});

const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** The fields that differ from what the provider lists. */
export function changedKeys(fields: ModelFields, base: ModelFields | undefined): (keyof ModelFields)[] {
  return base === undefined ? [] : KEYS.filter((k) => !same(fields[k], base[k]));
}

const isRow = (r: unknown): r is CatalogRow =>
  typeof r === "object" &&
  r !== null &&
  typeof (r as CatalogRow).provider === "string" &&
  typeof (r as CatalogRow).id === "string";

/** The catalog as editable entries, plus saved rows the list doesn't show (provider defaults, unlisted models). */
export function mergeModelRows(
  providers: ProviderModels[],
  saved: unknown,
): { entries: ModelEntry[]; kept: CatalogRow[] } {
  const rows = Array.isArray(saved) ? saved.filter(isRow) : [];
  const listed = new Set<string>();
  const entries: ModelEntry[] = [];
  for (const p of providers) {
    const star = rows.find((r) => r.provider === p.provider && r.id === "*");
    for (const m of p.models) {
      if (m.id === "") continue;
      listed.add(`${p.provider}\0${m.id}`);
      const custom = m.custom === true;
      const base = custom ? undefined : (m.base ?? m);
      entries.push({
        provider: p.provider,
        id: m.id,
        custom,
        show: m.show !== false,
        defaultShow: custom || (star?.show ?? base?.hidden !== true),
        ...(base === undefined ? {} : { base: fieldsOf(base) }),
        fields: fieldsOf(m),
      });
    }
  }
  const kept = rows.filter((r) => r.id === "*" || !listed.has(`${r.provider}\0${r.id}`));
  return { entries, kept };
}

/** The row to save for an entry: only what differs from the provider, or nothing. */
export function rowFor(e: ModelEntry): CatalogRow | undefined {
  const f = e.fields;
  const head: CatalogRow = {
    provider: e.provider,
    id: e.id,
    ...(e.show === e.defaultShow ? {} : { show: e.show }),
  };
  if (e.custom) {
    return {
      ...head,
      ...(f.name === "" || f.name === e.id ? {} : { name: f.name }),
      ...(f.contextWindow === undefined ? {} : { contextWindow: f.contextWindow }),
      ...(f.maxOutputTokens === undefined ? {} : { maxOutputTokens: f.maxOutputTokens }),
      ...(f.efforts.length === 0 ? {} : { efforts: f.efforts }),
      ...(f.defaultEffort === undefined ? {} : { defaultEffort: f.defaultEffort }),
      ...(f.fast ? { fast: true } : {}),
      custom: true,
    };
  }
  const changed = changedKeys(f, e.base);
  if (changed.length === 0 && head.show === undefined) return undefined;
  return Object.assign(head, Object.fromEntries(changed.map((k) => [k, f[k]])));
}

const trim = (n: number): string => String(Number(n.toFixed(1)));

/** 272000 → "272K", 1000000 → "1M", rounded for reading. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** The exact value in the shortest form, for an input. */
export function tokensInput(n: number | undefined): string {
  if (n === undefined) return "";
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n % 1_000 === 0) return `${n / 1_000}K`;
  return String(n);
}

/** Reads "200000", "200,000", "272K" or "1.5M". */
export function parseTokens(s: string): number {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(s.replace(/[\s,_]/g, ""));
  const scale = { "": 1, k: 1_000, m: 1_000_000 }[(m?.[2] ?? "").toLowerCase()] ?? 1;
  const n = m === null ? Number.NaN : Number(m[1]) * scale;
  if (!Number.isInteger(n) || n < 1)
    throw new Error("Token limits must be whole numbers, like 200000, 272K or 1M");
  return n;
}
