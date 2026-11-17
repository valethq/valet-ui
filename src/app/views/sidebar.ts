import { el } from "../dom";
import { icon, iconButton, selectChip } from "../icons";
import { childrenOf, type Indicator, rootOf, timeAgo, titleSuffixes, topLevel } from "../state";
import { subCount } from "../subagents";
import type { Project, Session } from "../types";
import { sessionMenuButton, syncSessionMenu } from "./session-menu";

export interface SidebarProps {
  projects: Project[];
  projectId: string | null;
  sessions: Session[];
  openId: string | null;
  unread: ReadonlySet<string>;
  indicators: ReadonlyMap<string, Indicator>;
  onProject(id: string): void;
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
  picker: HTMLSelectElement;
  add: HTMLButtonElement;
  /** The projects the picker currently lists, so unchanged options are left alone. */
  options: string;
}

const props = new WeakMap<HTMLElement, SidebarProps>();
const frames = new WeakMap<HTMLElement, Frame>();

/** The header, project picker and footer are built once: rebuilding them on every update dropped hover and
 * focus, and closed the picker while it was open. Handlers read the latest props. */
function frameFor(node: HTMLElement): Frame {
  const known = frames.get(node);
  if (known !== undefined) return known;
  const live = (): SidebarProps => props.get(node) as SidebarProps;
  const picker = el("select", { "aria-label": "Project" });
  picker.addEventListener("change", () => live().onProject(picker.value));
  const act = (name: Parameters<typeof iconButton>[0], label: string, cls: string, run: () => void) => {
    const button = iconButton(name, label, cls);
    button.addEventListener("click", run);
    return button;
  };
  const add = act("compose", "New session", "new-session", () => live().onNew());
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
    el(
      "div",
      { class: "project-picker" },
      selectChip(picker, "project", el("span", { class: "lead" }, icon("folder"))),
    ),
    el("div", { class: "sessions" }),
    el(
      "div",
      { class: "sidebar-foot" },
      act("settings", "Settings", "", () => live().onSettings()),
      act("logout", "Log out", "logout", () => live().onLogout()),
    ),
  );
  const frame = { picker, add, options: "" };
  frames.set(node, frame);
  return frame;
}

const rowLabel = (session: Session, dot: Indicator, suffix: number | undefined, now: number): string => {
  const label = dot === "running" ? "Working" : timeAgo(session.lastResponseAt ?? session.createdAt, now);
  return suffix === undefined ? label : `${label} · #${suffix}`;
};

export function renderSidebar(node: HTMLElement, p: SidebarProps): void {
  props.set(node, p);
  const frame = frameFor(node);
  const { picker } = frame;
  const options = JSON.stringify(p.projects.map((project) => [project.id, project.name]));
  if (options !== frame.options) {
    frame.options = options;
    picker.replaceChildren(
      ...p.projects.map((project) => el("option", { value: project.id, text: project.name })),
    );
  }
  if (p.projectId !== null && picker.value !== p.projectId) picker.value = p.projectId;
  frame.add.disabled = p.projectId === null;

  // Rows are rebuilt each render; compare with the previous list so only real
  // changes (new row, new open row, dot state, unread) animate.
  const prevList = node.querySelector<HTMLElement>(".sessions");
  const project = p.projectId ?? "";
  // a subagent chat highlights (and animates as) its top-level parent
  const openId = (p.openId === null ? undefined : rootOf(p.sessions, p.openId)?.id) ?? "";
  const same = prevList?.dataset.project === project;
  const prevOpen = prevList?.dataset.open;
  const prev = new Map<string, DOMStringMap>();
  for (const r of prevList?.querySelectorAll<HTMLElement>(".session-row") ?? []) {
    prev.set(r.dataset.id ?? "", r.dataset);
  }

  const shown = topLevel(p.sessions);
  const suffixes = titleSuffixes(shown);
  const now = Date.now();
  const list = el("div", { class: "sessions", "data-project": project, "data-open": openId });
  for (const session of shown) {
    const open = session.id === openId;
    const was = same ? prev.get(session.id) : undefined;
    const dot = p.indicators.get(session.id) ?? "done";
    const unread = p.unread.has(session.id);
    const moved = was !== undefined && prevOpen !== openId;
    const fx =
      same && was === undefined
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
    row.addEventListener("click", () => p.onSession(session.id));
    list.append(el("div", { class: "session-item" }, row, sessionMenuButton(session.id, p)));
  }
  if (shown.length === 0) list.append(el("div", { class: "hint", text: "No sessions yet." }));

  const scrollTop = prevList?.scrollTop ?? 0;
  prevList?.replaceWith(list);
  list.scrollTop = scrollTop;
  syncSessionMenu(list, p);
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
