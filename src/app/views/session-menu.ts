import { el, leave } from "../dom";
import { type IconName, icon, iconButton } from "../icons";
import type { Project } from "../types";

export interface SessionMenuActions {
  projects: Project[];
  /** The project the listed sessions are in; it is not offered as a move target. */
  projectId: string | null;
  onRename(id: string): void;
  onFork(id: string): void;
  onMove(id: string, projectId: string): void;
  onDelete(id: string): void;
}

interface Open {
  id: string;
  trigger: HTMLElement;
  menu: HTMLElement;
  actions: SessionMenuActions;
}

// Lives on document.body, not in the row: the sidebar's session list scrolls and would clip it.
let open: Open | null = null;

export function sessionMenuButton(id: string, actions: SessionMenuActions): HTMLButtonElement {
  const button = iconButton("more", "Session actions", "row-more");
  button.dataset.id = id;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => (open?.id === id ? close() : show(id, button, actions)));
  return button;
}

/** Call after the sidebar rebuilds its rows: moves an open menu onto its row's new button, or closes it. */
export function syncSessionMenu(list: HTMLElement, actions: SessionMenuActions): void {
  const current = open;
  if (current === null) return;
  current.actions = actions;
  const trigger = [...list.querySelectorAll<HTMLElement>(".row-more")].find(
    (b) => b.dataset.id === current.id,
  );
  if (trigger === undefined) {
    close();
    return;
  }
  current.trigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  place();
}

function show(id: string, trigger: HTMLElement, actions: SessionMenuActions): void {
  close();
  const menu = el(
    "div",
    { class: "menu session-menu", role: "menu" },
    menuItem("Rename", "pencil", () => pick((a) => a.onRename(id))),
    menuItem("Fork", "branch", () => pick((a) => a.onFork(id))),
    ...moveItems(id, actions),
    menuItem("Delete", "trash", () => pick((a) => a.onDelete(id)), "danger"),
  );
  document.body.append(menu);
  open = { id, trigger, menu, actions };
  trigger.setAttribute("aria-expanded", "true");
  place();
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", onScroll, true);
  menu.querySelector<HTMLElement>(".menu-item")?.focus({ preventScroll: true });
}

function moveItems(id: string, actions: SessionMenuActions): HTMLElement[] {
  const targets = actions.projects.filter((p) => p.id !== actions.projectId);
  if (targets.length === 0) return [];
  return [
    el("div", { class: "menu-title", text: "Move to project" }),
    ...targets.map((p) => menuItem(p.name, "folder", () => pick((a) => a.onMove(id, p.id)))),
  ];
}

function pick(run: (actions: SessionMenuActions) => void): void {
  const current = open;
  close();
  if (current !== null) run(current.actions);
}

function place(): void {
  if (open === null) return;
  const { menu, trigger } = open;
  const at = trigger.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(at.right - w, window.innerWidth - w - 8));
  const fitsBelow = at.bottom + 6 + h <= window.innerHeight - 8;
  const top = fitsBelow ? at.bottom + 6 : Math.max(8, at.top - 6 - h);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function close(): void {
  if (open === null) return;
  const { menu, trigger } = open;
  open = null;
  trigger.setAttribute("aria-expanded", "false");
  leave(menu, 240);
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", onScroll, true);
}

/** Scrolling moves the trigger, so the menu follows it; it closes only when the trigger is gone. */
function onScroll(): void {
  if (open?.trigger.isConnected) place();
  else close();
}

function onDocPointer(ev: Event): void {
  const target = ev.target as Node;
  if (open === null || open.menu.contains(target) || open.trigger.contains(target)) return;
  close();
}

function onKey(ev: KeyboardEvent): void {
  if (open === null) return;
  if (ev.key === "Escape") {
    const trigger = open.trigger;
    close();
    trigger.focus();
  } else if (ev.key === "Tab") {
    close();
  } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const items = [...(open?.menu.querySelectorAll<HTMLElement>(".menu-item") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = ev.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus();
  }
}

function menuItem(label: string, name: IconName, onSelect: () => void, cls = ""): HTMLButtonElement {
  const item = el("button", { class: ["menu-item", cls].filter(Boolean).join(" "), role: "menuitem" });
  item.append(
    el("span", { class: "menu-lead" }, icon(name)),
    el("span", { class: "menu-label", text: label }),
    el("span", { class: "menu-check" }, icon("check")),
  );
  item.addEventListener("click", onSelect);
  return item;
}
