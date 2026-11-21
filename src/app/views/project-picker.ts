import { ApiError, createProject, deleteProject, updateProject } from "../api";
import { el } from "../dom";
import { chipButton, icon } from "../icons";
import { type MenuSection, type PanelApi, popover } from "../menu";
import { enter } from "../motion";
import { applyOrder, loadOrder, moveItem, saveOrder } from "../project-order";
import type { Project } from "../types";
import { folderBrowser } from "./folder-browser";

export interface ProjectPickerProps {
  projects: Project[];
  projectId: string | null;
  onProject(id: string): void;
  /** The project list changed on the server; `select` is the project to show afterwards, if any. */
  onChanged(select: string | null): void;
}

export interface ProjectPicker {
  root: HTMLElement;
  update(p: ProjectPickerProps): void;
}

const messageOf = (e: unknown): string =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

const homeShort = (dir: string): string => dir.replace(/^\/home\/[^/]+/, "~");

function panelHead(title: string, api: PanelApi): HTMLElement {
  const back = el("button", { class: "fb-back", "aria-label": "Back", title: "Back" }, icon("arrowLeft"));
  back.addEventListener("click", api.back);
  return el("div", { class: "pp-head" }, back, el("span", { class: "pp-title", text: title }));
}

/** The sidebar's project chip: a model-picker-style menu with an add-project footer and per-row edit panels. */
export function createProjectPicker(initial: ProjectPickerProps): ProjectPicker {
  let props = initial;
  const chip = chipButton("project", icon("folder"), "Project");

  const addPanel = (api: PanelApi): HTMLElement =>
    el(
      "div",
      { class: "pp" },
      panelHead("Add project", api),
      folderBrowser({
        confirmLabel: "Add this folder",
        onPick: async (path) => {
          const made = await createProject(path);
          api.close();
          props.onChanged(made.id);
        },
      }),
    );

  const editPanel = (project: Project, api: PanelApi): HTMLElement => {
    const name = el("input", {
      class: "pp-name",
      type: "text",
      value: project.name,
      "aria-label": "Project name",
    });
    const error = el("div", { class: "fb-error" });
    const saveName = async (): Promise<void> => {
      const next = name.value.trim();
      if (next === "" || next === project.name) return;
      try {
        await updateProject(project.id, { name: next });
        props.onChanged(null);
        project.name = next;
      } catch (e) {
        error.textContent = messageOf(e);
      }
    };
    name.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      void saveName();
    });
    name.addEventListener("blur", () => void saveName());

    const dir = el("div", {
      class: "pp-dir",
      title: project.workspaceDir,
      text: homeShort(project.workspaceDir),
    });
    const relocate = el("button", { class: "pp-btn", text: "Change folder" });
    const remove = el("button", { class: "pp-btn danger", text: "Remove project" });
    let armed = false;
    remove.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        remove.textContent = "Confirm remove (files stay on disk)";
        return;
      }
      try {
        await deleteProject(project.id);
        api.close();
        props.onChanged(null);
      } catch (e) {
        armed = false;
        remove.textContent = "Remove project";
        error.textContent = messageOf(e);
      }
    });

    const body = el("div", { class: "pp" });
    const main = el(
      "div",
      { class: "pp-main" },
      panelHead("Edit project", api),
      name,
      dir,
      relocate,
      remove,
      error,
    );
    const back = (): void => {
      body.replaceChildren(main);
      enter(body, "back");
      api.fit(false);
    };
    relocate.addEventListener("click", () => {
      body.replaceChildren(
        panelHead("Change folder", { ...api, back }),
        folderBrowser({
          start: project.workspaceDir,
          confirmLabel: "Use this folder",
          onPick: async (path) => {
            await updateProject(project.id, { workspaceDir: path });
            api.close();
            props.onChanged(null);
          },
        }),
      );
      enter(body, "fwd");
      api.fit(true);
    });
    body.append(main);
    return body;
  };

  const ordered = (): Project[] => applyOrder(props.projects, loadOrder());

  const sections = (): MenuSection[] => [
    {
      reorder: (from, to) => saveOrder(moveItem(ordered(), from, to).map((p) => p.id)),
      items: ordered().map((p) => ({
        label: p.name,
        lead: icon("folder"),
        selected: p.id === props.projectId,
        onSelect: () => props.onProject(p.id),
        aside: { icon: "pencil", label: `Edit ${p.name}`, panel: (api) => editPanel(p, api) },
      })),
    },
    {
      items: [{ label: "Add project…", lead: icon("plus"), onSelect: () => {}, panel: addPanel }],
    },
  ];

  const root = popover(chip.button, sections, "project-pop", false, () =>
    document.querySelector(".sidebar .sessions"),
  );

  const update = (p: ProjectPickerProps): void => {
    props = p;
    const current = p.projects.find((x) => x.id === p.projectId);
    chip.text.textContent = current?.name ?? "No project";
    chip.button.title = current === undefined ? "Project" : `${current.name} · ${current.workspaceDir}`;
  };
  update(initial);
  return { root, update };
}
