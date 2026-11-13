import { el } from "./dom";
import { icon } from "./icons";

export interface MenuItem {
  label: string;
  lead?: HTMLElement;
  selected?: boolean;
  onSelect(): void;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

/** A click-to-open menu anchored above `trigger`. Sections are rebuilt on
 * every open; outside pointerdown or Escape closes it, arrows move focus. */
export function popover(trigger: HTMLButtonElement, sections: () => MenuSection[], cls = ""): HTMLElement {
  const root = el("span", { class: `pop ${cls}`.trim() }, trigger);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  let menu: HTMLElement | null = null;

  const items = (): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>(".menu-item") ?? [])];
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
    menu.remove();
    menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey);
  }

  function open(): void {
    const m = el("div", { class: "menu", role: "menu" });
    for (const s of sections()) {
      const group = el("div", { class: "menu-section" });
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
          close();
          it.onSelect();
        });
        group.append(b);
      }
      m.append(group);
    }
    menu = m;
    root.append(m);
    if (m.getBoundingClientRect().right > window.innerWidth - 8) m.classList.add("end");
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    const first = m.querySelector<HTMLElement>(".selected") ?? items()[0];
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: "nearest" });
  }

  trigger.addEventListener("click", () => (menu === null ? open() : close()));
  return root;
}
