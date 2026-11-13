import { el } from "../dom";
import { icon, iconButton, selectChip } from "../icons";
import { type Indicator, timeAgo, titleSuffixes } from "../state";
import type { Project, Session } from "../types";

export interface SidebarProps {
  projects: Project[];
  projectId: string | null;
  sessions: Session[];
  openId: string | null;
  unread: ReadonlySet<string>;
  indicators: ReadonlyMap<string, Indicator>;
  onProject(id: string): void;
  onSession(id: string): void;
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

  const suffixes = titleSuffixes(p.sessions);
  const now = Date.now();
  const list = el("div", { class: "sessions" });
  for (const session of p.sessions) {
    const row = el("button", {
      class: `session-row${session.id === p.openId ? " open" : ""}`,
      title: session.title ?? "Untitled",
    });
    const suffix = suffixes.get(session.id);
    const ago = timeAgo(session.lastMessageAt ?? session.updatedAt, now);
    row.append(
      el("span", { class: `dot ${p.indicators.get(session.id) ?? "done"}` }),
      el(
        "span",
        { class: "text" },
        el("span", { class: "title", text: session.title ?? "Untitled" }),
        el("span", { class: "meta", text: suffix === undefined ? ago : `${ago} · #${suffix}` }),
      ),
    );
    if (p.unread.has(session.id)) row.append(el("span", { class: "unread" }));
    row.addEventListener("click", () => p.onSession(session.id));
    list.append(row);
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
}
