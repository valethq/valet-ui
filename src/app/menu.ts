import { el, leave } from "./dom";
import { icon, type IconName } from "./icons";
import { focusDuration } from "./motion";

/** Handed to a panel: swap back to the menu's list, or close the whole menu. */
export interface PanelApi {
  back(): void;
  close(): void;
}

export interface MenuItem {
  label: string;
  lead?: HTMLElement;
  selected?: boolean;
  onSelect(): void;
  /** Instead of closing, selecting the row swaps the menu's content for this element. */
  panel?(api: PanelApi): HTMLElement;
  /** A small button beside the row that opens its own panel. */
  aside?: { icon: IconName; label: string; panel(api: PanelApi): HTMLElement };
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

const sizing = new WeakMap<HTMLElement, Animation>();

/** Runs `change`, then eases the menu's height from the old content to the new,
 * the way the settings modal resizes. Picks up from the current height mid-flight. */
export function resize(m: HTMLElement, change: () => void): void {
  const from = m.getBoundingClientRect().height;
  sizing.get(m)?.cancel();
  change();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = m.offsetHeight;
  if (Math.abs(from - to) < 1) return;
  const easing = getComputedStyle(m).getPropertyValue("--ease-focus").trim() || "ease";
  m.style.overflow = "hidden";
  const a = m.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: focusDuration(),
    easing,
  });
  sizing.set(m, a);
  a.onfinish = a.oncancel = () => {
    if (sizing.get(m) === a) m.style.removeProperty("overflow");
  };
}

/** `resize`, with the new children focused in. */
function swap(m: HTMLElement, change: () => void): void {
  resize(m, () => {
    change();
    for (const c of m.children) c.classList.add("swap-in");
  });
}

/** A click-to-open menu anchored above `trigger`. Sections are rebuilt on
 * every open; outside pointerdown or Escape closes it, arrows move focus. */
export function popover(
  trigger: HTMLButtonElement,
  sections: () => MenuSection[],
  cls = "",
  searchable = false,
): HTMLElement {
  const root = el("span", { class: `pop ${cls}`.trim() }, trigger);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  let menu: HTMLElement | null = null;

  const items = (): HTMLElement[] =>
    [...(menu?.querySelectorAll<HTMLElement>(".menu-item") ?? [])].filter((b) => b.style.display !== "none");
  const onDoc = (ev: Event): void => {
    if (!root.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      close();
      trigger.focus();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const all = items();
      const i = all.indexOf(document.activeElement as HTMLElement);
      const step = ev.key === "ArrowDown" ? 1 : -1;
      all[(i + step + all.length) % all.length]?.focus();
    }
  };

  function close(): void {
    if (menu === null) return;
    leave(menu, 240);
    menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey);
  }

  function fill(m: HTMLElement): void {
    m.replaceChildren();
    const api: PanelApi = { back: () => swap(m, () => fill(m)), close };
    const show = (panel: HTMLElement): void =>
      swap(m, () => {
        m.replaceChildren(panel);
        m.classList.add("panel");
      });
    m.classList.remove("panel");
    const search = searchable
      ? el("input", { class: "menu-search", type: "search", placeholder: "Search", "aria-label": "Search" })
      : null;
    const empty = el("div", { class: "menu-empty", text: "No matches" });
    empty.style.display = "none";
    if (search !== null) m.append(search);
    const groups: { title: string; group: HTMLElement }[] = [];
    for (const s of sections()) {
      const group = el("div", { class: "menu-section" });
      groups.push({ title: s.title ?? "", group });
      if (s.title !== undefined) group.append(el("div", { class: "menu-title", text: s.title }));
      for (const it of s.items) {
        const b = el("button", {
          class: `menu-item${it.selected === true ? " selected" : ""}`,
          role: "menuitemradio",
          "aria-checked": String(it.selected === true),
        });
        if (it.lead !== undefined) b.append(el("span", { class: "menu-lead" }, it.lead));
        b.append(
          el("span", { class: "menu-label", text: it.label }),
          el("span", { class: "menu-check" }, icon("check")),
        );
        b.addEventListener("click", () => {
          if (it.panel !== undefined) {
            show(it.panel(api));
            return;
          }
          close();
          it.onSelect();
        });
        if (it.aside === undefined) {
          group.append(b);
          continue;
        }
        const aside = it.aside;
        const side = el("button", { class: "menu-aside", "aria-label": aside.label, title: aside.label });
        side.append(icon(aside.icon));
        side.addEventListener("click", () => show(aside.panel(api)));
        group.append(el("div", { class: "menu-row" }, b, side));
      }
      m.append(group);
    }
    m.append(empty);
    const filter = (): void => {
      const q = search?.value.trim().toLowerCase() ?? "";
      let total = 0;
      for (const { title, group } of groups) {
        const inTitle = title.toLowerCase().includes(q);
        let any = false;
        for (const b of group.querySelectorAll<HTMLElement>(".menu-item")) {
          const hit = q === "" || inTitle || (b.textContent ?? "").toLowerCase().includes(q);
          const row = b.closest<HTMLElement>(".menu-row") ?? b;
          row.style.display = hit ? "" : "none";
          any ||= hit;
        }
        group.style.display = any ? "" : "none";
        if (any) total++;
      }
      empty.style.display = total === 0 ? "" : "none";
    };
    search?.addEventListener("input", filter);
    search?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      items()[0]?.click();
    });
    if (search !== null) search.focus({ preventScroll: true });
    const first = m.querySelector<HTMLElement>(".selected") ?? items()[0];
    if (search === null) first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: "nearest" });
  }

  function open(): void {
    const m = el("div", { class: "menu", role: "menu" });
    menu = m;
    root.append(m);
    fill(m);
    // Layout sizes, not the menu's rect: its entrance transform would skew that.
    const at = root.getBoundingClientRect();
    if (at.left + m.offsetWidth > window.innerWidth - 8) m.classList.add("end");
    if (at.top - 8 - m.offsetHeight < 8) m.classList.add("below");
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
  }

  trigger.addEventListener("click", () => (menu === null ? open() : close()));
  return root;
}
