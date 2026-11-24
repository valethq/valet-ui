import { el } from "../dom";
import { selectChip } from "../icons";
import { logoMarks, logosFor } from "../logos";
import { CUSTOM_FIELDS, type CatalogRow, type ModelEntry, mergeModelRows, rowFor } from "../model-rows";
import { collapse, enter } from "../motion";
import type { ProviderModels } from "../types";
import { type ModelItem, modelItem } from "./models-item";

export type CatalogLoader = () => Promise<ProviderModels[]>;

interface Group {
  node: HTMLElement;
  count: HTMLElement;
}

/** valet-agent's model list: models grouped by provider, each opening an editor under its row. */
export function modelsTable(
  value: unknown,
  load: CatalogLoader,
): { node: HTMLElement; read(): CatalogRow[]; ready: Promise<void> } {
  const node = el("div", { class: "models-table" });
  const status = el("div", { class: "hint", text: "Loading models…" });
  const items: ModelItem[] = [];
  const groups = new Map<string, Group>();
  let providers: ProviderModels[] = [];
  let kept: CatalogRow[] = [];

  const changed = () => node.dispatchEvent(new Event("change", { bubbles: true }));

  const recount = () => {
    for (const [provider, g] of groups) {
      const own = items.filter((i) => i.provider === provider);
      g.count.textContent = `${own.filter((i) => i.shown()).length} of ${own.length} in picker`;
      g.node.hidden = own.length === 0;
    }
  };

  const group = (provider: string): Group => {
    const known = groups.get(provider);
    if (known !== undefined) return known;
    const p = providers.find((x) => x.provider === provider);
    const label = p?.label || provider;
    const count = el("span", { class: "models-count" });
    const g = {
      node: el(
        "section",
        { class: "models-group", "aria-label": label },
        el(
          "div",
          { class: "models-group-head" },
          ...[logoMarks(logosFor(label, provider, p?.icon))].filter((x) => x !== undefined),
          el("span", { text: label }),
          count,
        ),
      ),
      count,
    };
    groups.set(provider, g);
    node.insertBefore(g.node, footer);
    return g;
  };

  const hooks = {
    opened(item: ModelItem) {
      for (const other of items) if (other !== item) other.setOpen(false);
    },
    remove(item: ModelItem) {
      items.splice(items.indexOf(item), 1);
      collapse(item.node);
      recount();
      changed();
    },
    changed,
  };

  const add = (entry: ModelEntry): ModelItem => {
    const item = modelItem(entry, hooks);
    item.node.addEventListener("change", recount);
    items.push(item);
    group(entry.provider).node.append(item.node);
    return item;
  };

  const providerSelect = el("select", { "aria-label": "Provider" });
  const addBtn = el("button", { type: "button", class: "chip", text: "Add model" });
  const footer = el("div", { class: "models-add" }, selectChip(providerSelect, "field-select"), addBtn);
  footer.hidden = true;
  addBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    if (provider === "") return;
    const item = add({
      provider,
      id: "",
      custom: true,
      show: true,
      defaultShow: true,
      fields: { name: "", ...CUSTOM_FIELDS },
    });
    recount();
    enter(item.node);
    item.setOpen(true);
    hooks.opened(item);
    changed();
  });

  node.append(status, footer);

  const ready = load()
    .then((list) => {
      providers = list;
      providerSelect.replaceChildren(
        ...list.map((p) => el("option", { value: p.provider, text: p.label || p.provider })),
      );
      footer.hidden = list.length === 0;
      const merged = mergeModelRows(list, value);
      kept = merged.kept;
      for (const entry of merged.entries) add(entry);
      recount();
      if (items.length === 0) status.textContent = "No models yet";
      else status.remove();
    })
    .catch((e: unknown) => {
      status.className = "hint error";
      status.textContent = e instanceof Error ? e.message : String(e);
    });

  return {
    node,
    ready,
    read: () => [
      ...kept,
      ...items.map((i) => rowFor(i.read())).filter((r): r is CatalogRow => r !== undefined),
    ],
  };
}
