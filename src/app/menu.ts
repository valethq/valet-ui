import { el, leave } from "./dom";
import { icon, type IconName } from "./icons";
import { focusDuration, focusEasing, reducedMotion } from "./motion";

/** Handed to a panel: swap back to the menu's list, or close the whole menu. */
export interface PanelApi {
  back(): void;
  close(): void;
  /** Stretch the open panel down to the menu's bound (or release it); only a folder browser wants this. */
  fit(on: boolean): void;
}

export interface MenuItem {
  label: string;
  lead?: HTMLElement;
  selected?: boolean;
  /** A switch row: shows `toggle` as its state, flips it on select and leaves the menu open. */
  toggle?: boolean;
  onSelect(): void;
  /** Instead of closing, selecting the row swaps the menu's content for this element. */
  panel?(api: PanelApi): HTMLElement;
  /** A small button beside the row that opens its own panel. */
  aside?: { icon: IconName; label: string; panel(api: PanelApi): HTMLElement };
}

export interface MenuSection {
  /** A mark beside the title, for sections named after something with a logo. */
  lead?: HTMLElement;
  title?: string;
  /** Rows can be dragged (or moved with Alt+Arrow) to a new index within the section. */
  reorder?(from: number, to: number): void;
  items: MenuItem[];
}

/** Makes `row` movable by pointer (a mouse drags at once; touch and pen press and hold, so scrolling still works)
 * and, with Alt+Arrow on `button`, one step at a time. `index` is the row's place among its section's rows. */
function dragRow(
  row: HTMLElement,
  button: HTMLElement,
  index: number,
  move: (from: number, to: number) => void,
): void {
  const rows = (): HTMLElement[] => [
    ...(row.parentElement?.querySelectorAll<HTMLElement>(".menu-row") ?? []),
  ];
  let pointer = -1;
  let startY = 0;
  let target = index;
  let active = false;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let swallow = false;

  const mark = (): void => {
    rows().forEach((r, i) => {
      r.classList.toggle("drop-before", i === target && target < index);
      r.classList.toggle("drop-after", i === target && target > index);
    });
  };
  const reset = (): void => {
    clearTimeout(hold);
    if (active && row.hasPointerCapture(pointer)) row.releasePointerCapture(pointer);
    active = false;
    pointer = -1;
    target = index;
    row.classList.remove("dragging");
    mark();
  };
  const begin = (): void => {
    active = true;
    row.setPointerCapture(pointer);
    row.classList.add("dragging");
  };

  row.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || pointer !== -1 || (ev.target as Element).closest(".menu-aside") !== null) return;
    pointer = ev.pointerId;
    startY = ev.clientY;
    if (ev.pointerType !== "mouse") hold = setTimeout(begin, 300);
  });
  row.addEventListener("pointermove", (ev) => {
    if (ev.pointerId !== pointer) return;
    if (!active) {
      const far = Math.abs(ev.clientY - startY);
      if (ev.pointerType === "mouse" ? far > 4 : far > 8) {
        if (ev.pointerType === "mouse") begin();
        else reset();
      }
      return;
    }
    const all = rows();
    target = Math.max(
      0,
      all.findIndex((r) => ev.clientY < r.getBoundingClientRect().bottom),
    );
    if (ev.clientY >= (all.at(-1)?.getBoundingClientRect().bottom ?? 0)) target = all.length - 1;
    mark();
  });
  row.addEventListener("pointerup", (ev) => {
    if (ev.pointerId !== pointer) return;
    const to = target;
    const moved = active;
    reset();
    if (!moved) return;
    swallow = true;
    setTimeout(() => {
      swallow = false;
    }, 0);
    if (to !== index) move(index, to);
  });
  row.addEventListener("pointercancel", (ev) => {
    if (ev.pointerId === pointer) reset();
  });
  row.addEventListener("touchmove", (ev) => active && ev.preventDefault(), { passive: false });
  row.addEventListener("contextmenu", (ev) => (active || hold !== undefined) && ev.preventDefault());
  row.addEventListener(
    "click",
    (ev) => {
      if (!swallow) return;
      ev.stopPropagation();
      ev.preventDefault();
    },
    true,
  );
  button.addEventListener("keydown", (ev) => {
    if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
    ev.preventDefault();
    ev.stopPropagation();
    move(index, index + (ev.key === "ArrowDown" ? 1 : -1));
  });
}

const sizing = new WeakMap<HTMLElement, Animation>();

/** Runs `change`, then eases the menu's height from the old content to the new,
 * the way the settings modal resizes. Picks up from the current height mid-flight. */
export function resize(m: HTMLElement, change: () => void): void {
  const from = m.getBoundingClientRect().height;
  sizing.get(m)?.cancel();
  change();
  if (reducedMotion()) return;
  const to = m.offsetHeight;
  if (Math.abs(from - to) < 1) return;
  m.style.overflow = "hidden";
  const a = m.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: focusDuration(),
    easing: focusEasing(),
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
  /** Panels in a menu opening below the trigger fill the space down to this element's bottom edge. */
  bound?: () => Element | null,
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

  function stretch(m: HTMLElement, on: boolean): void {
    m.style.removeProperty("height");
    m.style.removeProperty("max-height");
    const edge = bound?.()?.getBoundingClientRect().bottom;
    if (!on || edge === undefined || !m.classList.contains("below")) return;
    m.style.maxHeight = "none";
    m.style.height = `${Math.max(0, edge - (root.getBoundingClientRect().bottom + 8))}px`;
  }

  function fill(m: HTMLElement): void {
    m.replaceChildren();
    const api: PanelApi = {
      back: () => swap(m, () => fill(m)),
      close,
      fit: (on) => resize(m, () => stretch(m, on)),
    };
    const show = (panel: HTMLElement): void =>
      swap(m, () => {
        m.replaceChildren(panel);
        m.classList.add("panel");
        if (panel.querySelector(".fb") !== null) stretch(m, true);
      });
    m.classList.remove("panel", "searchable");
    stretch(m, false);
    const search = searchable
      ? el("input", { class: "menu-search", type: "search", placeholder: "Search", "aria-label": "Search" })
      : null;
    const empty = el("div", { class: "menu-empty", text: "No matches" });
    empty.style.display = "none";
    // Search stays outside the scroll body so it never rides the list.
    const body = search !== null ? el("div", { class: "menu-body" }) : m;
    if (search !== null) {
      m.classList.add("searchable");
      m.append(search, body);
    }
    const groups: { title: string; group: HTMLElement }[] = [];
    for (const s of sections()) {
      const group = el("div", { class: "menu-section" });
      const si = groups.push({ title: s.title ?? "", group }) - 1;
      const reorder = s.reorder;
      const move =
        reorder === undefined
          ? undefined
          : (from: number, to: number): void => {
              if (to < 0 || to >= s.items.length) return;
              reorder(from, to);
              fill(m);
              m.querySelectorAll(".menu-section")
                [si]?.querySelectorAll<HTMLElement>(".menu-item")
                [to]?.focus();
            };
      if (s.title !== undefined)
        group.append(
          el(
            "div",
            { class: "menu-title" },
            ...[s.lead, el("span", { text: s.title })].filter((n) => n !== undefined),
          ),
        );
      for (const [index, it] of s.items.entries()) {
        const toggled = it.toggle !== undefined;
        const b = el("button", {
          class: `menu-item${it.selected === true ? " selected" : ""}`,
          role: toggled ? "menuitemcheckbox" : "menuitemradio",
          "aria-checked": String(toggled ? it.toggle === true : it.selected === true),
        });
        if (it.lead !== undefined) b.append(el("span", { class: "menu-lead" }, it.lead));
        b.append(
          el("span", { class: "menu-label", text: it.label }),
          toggled ? el("span", { class: "menu-switch" }) : el("span", { class: "menu-check" }, icon("check")),
        );
        b.addEventListener("click", () => {
          if (toggled) {
            b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"));
            it.onSelect();
            return;
          }
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
        const row = el("div", { class: "menu-row" }, b, side);
        if (move !== undefined) dragRow(row, b, index, move);
        group.append(row);
      }
      body.append(group);
    }
    body.append(empty);
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
