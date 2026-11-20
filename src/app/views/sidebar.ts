import { el, leave } from "../dom";
import { icon, iconButton } from "../icons";
import { glide } from "../motion";
import {
  childrenOf,
  type Indicator,
  rootOf,
  searchSessions,
  timeAgo,
  titleSuffixes,
  topLevel,
} from "../state";
import { subCount } from "../subagents";
import type { Project, Session } from "../types";
import { createProjectPicker, type ProjectPicker } from "./project-picker";
import { sessionMenuButton, syncSessionMenu } from "./session-menu";

export interface SidebarProps {
  projects: Project[];
  projectId: string | null;
  sessions: Session[];
  openId: string | null;
  unread: ReadonlySet<string>;
  indicators: ReadonlyMap<string, Indicator>;
  onProject(id: string): void;
  onProjectsChanged(select: string | null): void;
  onSession(id: string): void;
  onRename(id: string): void;
  onFork(id: string): void;
  onMove(id: string, projectId: string): void;
  onDelete(id: string): void;
  onNew(): void;
  onLogout(): void;
  onSettings(): void;
  onCollapse(): void;
}

interface Frame {
  picker: ProjectPicker;
  add: HTMLButtonElement;
  search: HTMLInputElement;
}

const props = new WeakMap<HTMLElement, SidebarProps>();
const frames = new WeakMap<HTMLElement, Frame>();

/** The header, project picker and footer are built once: rebuilding them on every update dropped hover and
 * focus, and closed the picker while it was open. Handlers read the latest props. */
function frameFor(node: HTMLElement): Frame {
  const known = frames.get(node);
  if (known !== undefined) return known;
  const live = (): SidebarProps => props.get(node) as SidebarProps;
  const picker = createProjectPicker({
    ...live(),
    onProject: (id) => live().onProject(id),
    onChanged: (select) => live().onProjectsChanged(select),
  });
  const act = (name: Parameters<typeof iconButton>[0], label: string, cls: string, run: () => void) => {
    const button = iconButton(name, label, cls);
    button.addEventListener("click", run);
    return button;
  };
  const add = act("compose", "New session", "new-session", () => live().onNew());
  const search = el("input", {
    type: "search",
    class: "session-search-input",
    placeholder: "Search sessions",
    "aria-label": "Search sessions",
  });
  search.addEventListener("input", () => renderSidebar(node, live()));
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || search.value === "") return;
    e.stopPropagation();
    search.value = "";
    renderSidebar(node, live());
  });
  node.replaceChildren(
    el(
      "div",
      { class: "sidebar-head" },
      el("span", { class: "brand", text: "valet" }),
      el(
        "div",
        { class: "actions" },
        add,
        act("sidebar", "Collapse sidebar", "collapse-btn", () => live().onCollapse()),
      ),
    ),
    el("div", { class: "project-picker" }, picker.root),
    el("label", { class: "session-search" }, icon("search"), search),
    el("div", { class: "sessions" }),
    el(
      "div",
      { class: "sidebar-foot" },
      act("settings", "Settings", "", () => live().onSettings()),
      act("logout", "Log out", "logout", () => live().onLogout()),
    ),
  );
  const frame = { picker, add, search };
  frames.set(node, frame);
  return frame;
}

/** Rows on a project switch fade in one after another, this far apart, up to `STAGGER_ROWS` rows. */
const STAGGER_MS = 22;
const STAGGER_ROWS = 12;

/** Where a row sat before a re-render: its viewport top, for the slide, and its box in the list, for a ghost. */
interface RowPlace {
  top: number;
  box: { top: number; left: number; width: number };
  visible: boolean;
}

/** The list's live rows (not ones already fading out), by session id. */
function itemsOf(list: HTMLElement | null): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const item of list?.querySelectorAll<HTMLElement>(":scope > .session-item:not(.leaving)") ?? []) {
    const id = item.querySelector<HTMLElement>(".session-row")?.dataset.id;
    if (id !== undefined) out.set(id, item);
  }
  return out;
}

function placesOf(list: HTMLElement, items: Map<string, HTMLElement>): Map<string, RowPlace> {
  const view = list.getBoundingClientRect();
  const out = new Map<string, RowPlace>();
  for (const [id, item] of items) {
    const r = item.getBoundingClientRect();
    out.set(id, {
      top: r.top,
      box: { top: item.offsetTop, left: item.offsetLeft, width: item.offsetWidth },
      visible: r.bottom > view.top && r.top < view.bottom,
    });
  }
  return out;
}

/** A removed row fades out where it stood, over the new list, while the rows around it close the gap. */
function ghost(item: HTMLElement, place: RowPlace, into: HTMLElement): void {
  item.style.position = "absolute";
  item.style.top = `${place.box.top}px`;
  item.style.left = `${place.box.left}px`;
  item.style.width = `${place.box.width}px`;
  item.setAttribute("aria-hidden", "true");
  item.classList.add("fx-out");
  into.append(item);
  leave(item, 360);
}

const rowLabel = (session: Session, dot: Indicator, suffix: number | undefined, now: number): string => {
  const label = dot === "running" ? "Working" : timeAgo(session.lastResponseAt ?? session.createdAt, now);
  return suffix === undefined ? label : `${label} · #${suffix}`;
};

export function renderSidebar(node: HTMLElement, p: SidebarProps): void {
  props.set(node, p);
  const frame = frameFor(node);
  const { picker } = frame;
  picker.update({
    projects: p.projects,
    projectId: p.projectId,
    onProject: (id) => p.onProject(id),
    onChanged: (select) => p.onProjectsChanged(select),
  });
  frame.add.disabled = p.projectId === null;

  // Rows are rebuilt each render; compare with the previous list so only real
  // changes (new row, new open row, dot state, unread) animate.
  const prevList = node.querySelector<HTMLElement>(".sessions");
  const project = p.projectId ?? "";
  // a subagent chat highlights (and animates as) its top-level parent
  const openId = (p.openId === null ? undefined : rootOf(p.sessions, p.openId)?.id) ?? "";
  const same = prevList?.dataset.project === project;
  const switched = prevList != null && !same;
  const prevOpen = prevList?.dataset.open;
  const prevItems = itemsOf(prevList);
  const prev = new Map<string, DOMStringMap>();
  for (const [id, item] of prevItems) {
    const row = item.querySelector<HTMLElement>(".session-row");
    if (row !== null) prev.set(id, row.dataset);
  }

  const all = topLevel(p.sessions);
  const suffixes = titleSuffixes(all);
  const shown = searchSessions(p.sessions, all, frame.search.value);
  const now = Date.now();
  const list = el("div", { class: "sessions", "data-project": project, "data-open": openId });
  // Rows that came, went or changed places slide; a render that kept the order (a dot, a title) measures nothing.
  const ids = [...prevItems.keys()];
  const reordered = ids.length !== shown.length || ids.some((id, i) => shown[i]?.id !== id);
  const before = same && prevList != null && reordered ? placesOf(prevList, prevItems) : null;
  shown.forEach((session, i) => {
    const open = session.id === openId;
    const was = same ? prev.get(session.id) : undefined;
    const dot = p.indicators.get(session.id) ?? "done";
    const unread = p.unread.has(session.id);
    const moved = was !== undefined && prevOpen !== openId;
    const fx =
      (same && was === undefined) || switched
        ? " enter"
        : moved && open
          ? " opening"
          : moved && session.id === prevOpen
            ? " closing"
            : "";
    const row = el("button", {
      class: `session-row${open ? " open" : ""}${fx}`,
      title: session.title ?? "Untitled",
      "data-id": session.id,
      "data-dot": dot,
      "data-unread": unread ? "1" : "",
    });
    const subs = childrenOf(p.sessions, session.id);
    const subDots = subs.map((s) => p.indicators.get(s.id));
    const subState = subDots.includes("attention") ? " need" : subDots.includes("running") ? " live" : "";
    row.append(
      el(
        "span",
        { class: "text" },
        el("span", { class: "title", text: session.title ?? "Untitled" }),
        el(
          "span",
          { class: "meta" },
          el("span", { class: `dot ${dot}${was !== undefined && was.dot !== dot ? " pop" : ""}` }),
          el("span", { class: "meta-text", text: rowLabel(session, dot, suffixes.get(session.id), now) }),
          ...(subs.length === 0
            ? []
            : [
                el(
                  "span",
                  { class: `subs${subState}` },
                  icon("branch"),
                  el("span", { text: subCount(subs.length) }),
                ),
              ]),
        ),
      ),
    );
    if (switched) row.style.animationDelay = `${Math.min(i, STAGGER_ROWS) * STAGGER_MS}ms`;
    row.addEventListener("click", () => p.onSession(session.id));
    list.append(el("div", { class: "session-item" }, row, sessionMenuButton(session.id, p)));
  });
  if (shown.length === 0) {
    list.append(
      el("div", { class: "hint", text: all.length === 0 ? "No sessions yet." : "No matching sessions." }),
    );
  }

  const scrollTop = prevList?.scrollTop ?? 0;
  const fading = [...(prevList?.querySelectorAll<HTMLElement>(":scope > .session-item.leaving") ?? [])];
  prevList?.replaceWith(list);
  list.scrollTop = scrollTop;
  syncSessionMenu(list, p);
  list.append(...fading);
  if (before === null) return;
  const items = itemsOf(list);
  for (const [id, place] of before) {
    const item = items.get(id);
    const old = prevItems.get(id);
    if (item === undefined) {
      if (place.visible && old !== undefined) ghost(old, place, list);
    } else if (place.visible) {
      glide(item, place.top);
    } else {
      item.querySelector(".session-row")?.classList.add("enter");
    }
  }
}

/** Rewrites the relative times ("5m", "3h") on the rows already shown, for the passing of time alone. */
export function refreshTimes(node: HTMLElement, p: SidebarProps): void {
  const shown = topLevel(p.sessions);
  const suffixes = titleSuffixes(shown);
  const byId = new Map(shown.map((s) => [s.id, s]));
  const now = Date.now();
  for (const row of node.querySelectorAll<HTMLElement>(".session-row")) {
    const session = byId.get(row.dataset.id ?? "");
    const text = row.querySelector<HTMLElement>(".meta-text");
    if (session === undefined || text === null) continue;
    const label = rowLabel(session, p.indicators.get(session.id) ?? "done", suffixes.get(session.id), now);
    if (text.textContent !== label) text.textContent = label;
  }
}
