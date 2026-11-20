// One catalog model → one picker family. Effort/fast are options on the
// selection, not encoded in the model id.

import type { ProviderModels } from "./types";

export interface ModelFamily {
  /** Catalog model id; unique within a provider. */
  key: string;
  provider: string;
  providerLabel: string;
  /** The provider's logo key, when it names one. */
  providerIcon?: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  fast: boolean;
  fastByDefault: boolean;
}

/** Preferred effort if listed, else defaultEffort, else the last effort, else none. */
export function pickEffort(f: ModelFamily, preferred?: string): string | undefined {
  if (preferred !== undefined && f.efforts.includes(preferred)) return preferred;
  if (f.defaultEffort !== undefined && f.efforts.includes(f.defaultEffort)) return f.defaultEffort;
  return f.efforts.at(-1);
}

/** Whether the catalog wants this model in the picker. */
function inPicker(m: { show?: boolean; hidden?: boolean }): boolean {
  if (m.show === false) return false;
  if (m.show === true) return true;
  return m.hidden !== true;
}

/** One family per listed model; provider order preserved; empty / disabled skipped. */
export function groupModels(providers: ProviderModels[]): ModelFamily[] {
  const families: ModelFamily[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      if (m.id === "" || !inPicker(m)) continue;
      families.push({
        key: m.id,
        provider: p.provider,
        providerLabel: p.label,
        ...(p.icon === undefined ? {} : { providerIcon: p.icon }),
        label: m.name === "" ? m.id : m.name,
        efforts: m.efforts ?? [],
        ...(m.defaultEffort === undefined ? {} : { defaultEffort: m.defaultEffort }),
        fast: m.fast === true,
        fastByDefault: m.fastByDefault === true,
      });
    }
  }
  return families;
}
