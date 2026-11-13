import { el } from "../dom";
import { sessionColor } from "../state";
import type { Project, Session } from "../types";

export interface SidebarProps {
  projects: Project[];
  projectId: string | null;
  sessions: Session[];
  openId: string | null;
  unread: ReadonlySet<string>;
  onProject(id: string): void;
  onSession(id: string): void;
  onNew(): void;
}

export function renderSidebar(node: HTMLElement, p: SidebarProps): void {
  const picker = el("select");
  for (const project of p.projects) {
    picker.append(el("option", { value: project.id, text: project.name }));
  }
  if (p.projectId !== null) picker.value = p.projectId;
  picker.addEventListener("change", () => p.onProject(picker.value));

  const list = el("div", { class: "sessions" });
  for (const session of p.sessions) {
    const row = el("button", {
      class: `session-row${session.id === p.openId ? " open" : ""}`,
      title: session.title ?? "Untitled",
    });
    const dot = el("span", { class: "dot" });
    dot.style.background = sessionColor(session);
    row.append(dot, el("span", { class: "title", text: session.title ?? "Untitled" }));
    if (p.unread.has(session.id)) row.append(el("span", { class: "unread" }));
    row.addEventListener("click", () => p.onSession(session.id));
    list.append(row);
  }
  if (p.sessions.length === 0) list.append(el("div", { class: "hint", text: "No sessions yet." }));

  const add = el("button", { class: "new-session", text: "New session" });
  add.disabled = p.projectId === null;
  add.addEventListener("click", () => p.onNew());

  node.replaceChildren(el("div", { class: "project-picker" }, picker), list, add);
}
