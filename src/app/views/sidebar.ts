import { el } from "../dom";
import { icon, iconButton, selectChip } from "../icons";
import { type Indicator, timeAgo, titleSuffixes } from "../state";
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
  onDelete(id: string): void;
  onNew(): void;
  onLogout(): void;
  onSettings(): void;
  onCollapse(): void;
}

export function renderSidebar(node: HTMLElement, p: SidebarProps): void {
  const picker = el("select", { "aria-label": "Project" });
  for (const project of p.projects) {
    picker.append(el("option", { value: project.id, text: project.name }));
  }
  if (p.projectId !== null) picker.value = p.projectId;
  picker.addEventListener("change", () => p.onProject(picker.value));

  // Rows are rebuilt each render; compare with the previous list so only real
  // changes (new row, new open row, dot state, unread) animate.
  const prevList = node.querySelector<HTMLElement>(".sessions");
  const project = p.projectId ?? "";
  const openId = p.openId ?? "";
  const same = prevList?.dataset.project === project;
  const prevOpen = prevList?.dataset.open;
  const prev = new Map<string, DOMStringMap>();
  for (const r of prevList?.querySelectorAll<HTMLElement>(".session-row") ?? []) {
    prev.set(r.dataset.id ?? "", r.dataset);
  }

  const suffixes = titleSuffixes(p.sessions);
  const now = Date.now();
  const list = el("div", { class: "sessions", "data-project": project, "data-open": openId });
  for (const session of p.sessions) {
    const open = session.id === p.openId;
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
    const suffix = suffixes.get(session.id);
    const label = dot === "running" ? "Working" : timeAgo(session.lastMessageAt ?? session.updatedAt, now);
    row.append(
      el("span", { class: `dot ${dot}${was !== undefined && was.dot !== dot ? " pop" : ""}` }),
      el(
        "span",
        { class: "text" },
        el("span", { class: "title", text: session.title ?? "Untitled" }),
        el("span", { class: "meta", text: suffix === undefined ? label : `${label} · #${suffix}` }),
      ),
    );
    if (unread)
      row.append(el("span", { class: `unread${was !== undefined && was.unread !== "1" ? " pop" : ""}` }));
    row.addEventListener("click", () => p.onSession(session.id));
    list.append(el("div", { class: "session-item" }, row, sessionMenuButton(session.id, p)));
  }
  if (p.sessions.length === 0) list.append(el("div", { class: "hint", text: "No sessions yet." }));

  const add = iconButton("compose", "New session", "new-session");
  add.disabled = p.projectId === null;
  add.addEventListener("click", () => p.onNew());

  const collapse = iconButton("sidebar", "Collapse sidebar", "collapse-btn");
  collapse.addEventListener("click", () => p.onCollapse());

  const settings = iconButton("settings", "Settings");
  settings.addEventListener("click", () => p.onSettings());

  const logout = iconButton("logout", "Log out", "logout");
  logout.addEventListener("click", () => p.onLogout());

  const scrollTop = node.querySelector<HTMLElement>(".sessions")?.scrollTop ?? 0;
  node.replaceChildren(
    el(
      "div",
      { class: "sidebar-head" },
      el("span", { class: "brand", text: "valet" }),
      el("div", { class: "actions" }, add, collapse),
    ),
    el(
      "div",
      { class: "project-picker" },
      selectChip(picker, "project", el("span", { class: "lead" }, icon("folder"))),
    ),
    list,
    el("div", { class: "sidebar-foot" }, settings, logout),
  );
  list.scrollTop = scrollTop;
  syncSessionMenu(list, p);
}
