import { el, leave } from "../dom";
import { experimentalEnabled, setExperimental } from "../experimental";
import { icon, iconButton } from "../icons";
import { enter } from "../motion";
import type { ContributionView, CorePluginSettings, SettingsGroup } from "../types";
import { configPage, type FormDeps } from "./settings-form";
import {
  buildSettingsPages,
  GROUP_LABEL,
  groupPages,
  groupSubtitle,
  type SettingsPage,
} from "./settings-pages";
import { themeSection } from "./themes";

export interface SettingsDeps extends FormDeps {
  listCore(): Promise<CorePluginSettings[]>;
  listContributions(): Promise<ContributionView[]>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The Experimental page: one switch stored in this browser (a cookie), not server config. */
function experimentalSection(): HTMLElement {
  const box = el("input", { type: "checkbox", class: "switch", id: "ui-experimental-enabled" });
  box.checked = experimentalEnabled();
  const note = el("div", { class: "set-note warning", text: "Reload the page to apply" });
  note.hidden = true;
  box.addEventListener("change", () => {
    setExperimental(box.checked);
    note.hidden = false;
  });
  return el(
    "section",
    { class: "settings-section" },
    el(
      "div",
      { class: "set-head" },
      el(
        "div",
        { class: "set-head-text" },
        el("h3", {}, "Experimental"),
        el("p", {
          class: "set-head-desc",
          text: "Early features stored in this browser only. Enables compressed responses and paged chat loading.",
        }),
      ),
    ),
    el(
      "div",
      { class: "set-list" },
      el(
        "div",
        { class: "set-row toggle" },
        el(
          "div",
          { class: "set-text" },
          el(
            "div",
            { class: "set-title" },
            el("label", { class: "set-label", for: box.id, text: "Enable experimental features" }),
          ),
          el("p", { class: "set-desc", text: "Turn off if you run into issues." }),
          note,
        ),
        el("div", { class: "set-ctl" }, box),
      ),
    ),
  );
}

function builtinPages(): SettingsPage[] {
  const page = (id: string, title: string, order: number, kind: "theme" | "experimental"): SettingsPage => ({
    id,
    title,
    group: "system",
    order,
    kind,
    subsections: [],
    runtime: [],
    primary: false,
  });
  return [
    page("ui-theme", "Themes", 900, "theme"),
    page("ui-experimental", "Experimental", 901, "experimental"),
  ];
}

function pagePanel(page: SettingsPage, deps: SettingsDeps): HTMLElement {
  if (page.kind === "theme") return themeSection();
  if (page.kind === "experimental") return experimentalSection();
  return configPage(page, deps);
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

  let selected = -1;
  const select = (i: number, focus = false): void => {
    const from = selected;
    selected = i;
    tabs.forEach((t, j) => {
      const on = j === i;
      const b = buttons[j];
      if (b !== undefined) {
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      }
      t.panel.hidden = !on;
    });
    const panel = tabs[i]?.panel;
    if (from >= 0 && from !== i && panel !== undefined) {
      body.scrollTop = 0;
      enter(panel);
    }
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

const NARROW_SETTINGS = "(max-width: 900px), (max-height: 500px) and (pointer: coarse)";

function navRow(label: string, sub: string, onSelect: () => void): HTMLButtonElement {
  const text = el(
    "span",
    { class: "settings-nav-text" },
    el("span", { class: "settings-nav-label", text: label }),
  );
  if (sub !== "") text.append(el("span", { class: "settings-nav-sub", text: sub }));
  const b = el(
    "button",
    { class: "settings-nav-row", type: "button" },
    text,
    el("span", { class: "chevron" }, icon("chevronRight")),
  );
  b.addEventListener("click", onSelect);
  return b;
}

/**
 * Mobile settings: Groups → pages in that group → page form.
 * Returns `back()` which pops one level (true) or says we are at the root (false).
 */
function drillDown(
  grouped: { group: SettingsGroup; pages: SettingsPage[] }[],
  deps: SettingsDeps,
  chrome: { title: HTMLElement; back: HTMLButtonElement },
): { root: HTMLElement; back: () => boolean } {
  const panels = new Map<string, HTMLElement>();
  const pageOf = new Map<string, SettingsPage>();
  for (const g of grouped) {
    for (const p of g.pages) {
      pageOf.set(p.id, p);
      panels.set(p.id, pagePanel(p, deps));
    }
  }

  type Loc =
    | { kind: "root" }
    | { kind: "group"; group: SettingsGroup }
    | { kind: "page"; group: SettingsGroup; id: string };
  let loc: Loc = { kind: "root" };
  let shownDepth = -1;
  const depth = (l: Loc): number => (l.kind === "root" ? 0 : l.kind === "group" ? 1 : 2);
  const root = el("div", { class: "settings-drill" });

  const showGroups = (): HTMLElement => {
    const list = el("div", { class: "settings-nav", role: "list" });
    for (const g of grouped) {
      const sub = groupSubtitle(g.pages.map((p) => p.title));
      list.append(
        navRow(GROUP_LABEL[g.group], sub, () => {
          loc = { kind: "group", group: g.group };
          paint();
        }),
      );
    }
    return list;
  };

  const showPages = (group: SettingsGroup): HTMLElement => {
    const list = el("div", { class: "settings-nav", role: "list" });
    const pages = grouped.find((g) => g.group === group)?.pages ?? [];
    for (const p of pages) {
      list.append(
        navRow(p.title, "", () => {
          loc = { kind: "page", group, id: p.id };
          paint();
        }),
      );
    }
    return list;
  };

  const paint = (): void => {
    draw();
    const d = depth(loc);
    const first = root.firstElementChild;
    if (shownDepth >= 0 && d !== shownDepth && first !== null) {
      const way = d > shownDepth ? "fwd" : "back";
      enter(first, way);
      enter(chrome.title, way);
    }
    shownDepth = d;
  };

  const draw = (): void => {
    if (loc.kind === "root") {
      chrome.title.textContent = "Settings";
      chrome.back.hidden = true;
      root.classList.remove("settings-drill-page");
      root.replaceChildren(showGroups());
      return;
    }
    if (loc.kind === "group") {
      chrome.title.textContent = GROUP_LABEL[loc.group];
      chrome.back.hidden = false;
      root.classList.remove("settings-drill-page");
      root.replaceChildren(showPages(loc.group));
      return;
    }
    const page = pageOf.get(loc.id);
    const panel = panels.get(loc.id);
    chrome.title.textContent = page?.title ?? "Settings";
    chrome.back.hidden = false;
    root.classList.add("settings-drill-page");
    if (panel === undefined) {
      root.replaceChildren(el("div", { class: "hint", text: "Page not found" }));
      return;
    }
    panel.hidden = false;
    root.replaceChildren(el("div", { class: "settings-panels" }, panel));
  };

  const back = (): boolean => {
    if (loc.kind === "page") {
      loc = { kind: "group", group: loc.group };
      paint();
      return true;
    }
    if (loc.kind === "group") {
      loc = { kind: "root" };
      paint();
      return true;
    }
    return false;
  };

  paint();
  return { root, back };
}

/** Opens the settings dialog: one page per plugin and section (settings v3), plus Themes and Experimental. */
export function openSettings(deps: SettingsDeps): void {
  if (document.querySelector(".modal-backdrop:not(.leaving)") !== null) return;
  const opener = document.activeElement as HTMLElement | null;
  const title = el("h2", { id: "settings-title", text: "Settings" });
  const back = iconButton("chevronLeft", "Back", "settings-back");
  back.hidden = true;
  const close = iconButton("close", "Close");
  const content = el("div", { class: "modal-body" });
  const dialog = el(
    "div",
    {
      class: "modal settings-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "settings-title",
      tabindex: "-1",
    },
    el("div", { class: "modal-head" }, el("div", { class: "modal-head-start" }, back, title), close),
    content,
  );
  const backdrop = el("div", { class: "modal-backdrop" }, dialog);

  /** Null until the server pages have loaded, so the dialog never opens on a built-in page. */
  let pages: SettingsPage[] | null = null;
  let popLevel: (() => boolean) | null = null;
  const mq = matchMedia(NARROW_SETTINGS);

  const mount = (): void => {
    popLevel = null;
    back.hidden = true;
    back.onclick = null;
    title.textContent = "Settings";
    if (pages === null) {
      content.replaceChildren(el("div", { class: "hint", text: "Loading…" }));
      return;
    }
    if (mq.matches) {
      const drilled = drillDown(groupPages(pages), deps, { title, back });
      popLevel = drilled.back;
      back.onclick = () => {
        popLevel?.();
      };
      content.replaceChildren(drilled.root);
    } else {
      const tabs = groupPages(pages).flatMap(({ group, pages: list }) =>
        list.map((p) => ({
          label: p.title,
          group: GROUP_LABEL[group],
          panel: pagePanel(p, deps),
        })),
      );
      content.replaceChildren(tabbed(tabs));
    }
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    if (popLevel?.()) return;
    dismiss();
  };
  function dismiss(): void {
    leave(backdrop);
    document.removeEventListener("keydown", onKey);
    mq.removeEventListener("change", mount);
    opener?.focus();
  }
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("pointerdown", (ev) => {
    if (ev.target === backdrop) dismiss();
  });
  document.addEventListener("keydown", onKey);
  mq.addEventListener("change", mount);
  document.body.append(backdrop);
  dialog.focus();
  mount();

  Promise.all([deps.listCore(), deps.listContributions().catch((): ContributionView[] => [])])
    .then(([core, contributions]) => {
      pages = [...buildSettingsPages(core, contributions), ...builtinPages()];
      mount();
    })
    .catch((e: unknown) => {
      pages = builtinPages();
      mount();
      content.prepend(el("div", { class: "hint error", text: `Couldn't load settings: ${errorText(e)}` }));
    });
}
