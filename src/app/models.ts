// Model-id grouping: providers list one entry per effort variant, so ids like
// "claude-opus-5.5-high" collapse into a "claude-opus-5.5" family. Pure
// functions (unit-tested); the header pickers consume the families.

import type { ProviderModels } from "./types";

const EFFORT_SUFFIX = /-(none|minimal|low|medium|high|xhigh|max)$/;
const EXTRA_FAMILY = /^fusion-|sidekick|-(fast|priority|lightning)(-|$)/;

export interface ModelVariant {
  id: string;
  name: string;
  /** Suffix stripped from the id ("high"), or "default" when there is none. */
  effort: string;
}

export interface ModelFamily {
  /** Id with the effort suffix removed; unique within a provider. */
  key: string;
  provider: string;
  providerLabel: string;
  /** Display label: first variant's name minus the effort word. */
  label: string;
  /** Goes into the trailing "More variants" optgroup. */
  more: boolean;
  variants: ModelVariant[];
}

export function familyOf(id: string): { family: string; effort: string } {
  const m = EFFORT_SUFFIX.exec(id);
  if (m === null) return { family: id, effort: "default" };
  return { family: id.slice(0, m.index), effort: m[1] as string };
}

function familyLabel(name: string, effort: string, fallback: string): string {
  if (effort !== "default") {
    const stripped = name.replace(new RegExp(`[\\s(-]*${effort}\\s*\\)?\\s*$`, "i"), "").trim();
    if (stripped !== "") return stripped;
  }
  return name === "" ? fallback : name;
}

export function groupModels(providers: ProviderModels[]): ModelFamily[] {
  const families: ModelFamily[] = [];
  const index = new Map<string, ModelFamily>();
  for (const p of providers) {
    for (const m of p.models) {
      const { family, effort } = familyOf(m.id);
      const k = `${p.provider} ${family}`;
      let f = index.get(k);
      if (f === undefined) {
        f = {
          key: family,
          provider: p.provider,
          providerLabel: p.label,
          label: "",
          more: EXTRA_FAMILY.test(family),
          variants: [],
        };
        index.set(k, f);
        families.push(f);
      }
      f.variants.push({ id: m.id, name: m.name, effort });
    }
  }
  for (const f of families) {
    const first = f.variants[0];
    f.label = first === undefined ? f.key : familyLabel(first.name, first.effort, f.key);
  }
  return families;
}
