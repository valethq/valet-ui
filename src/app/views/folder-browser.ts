import { type DirListing, listDirs, makeDir } from "../api";
import { el } from "../dom";
import { icon } from "../icons";

export interface FolderBrowserOptions {
  /** Where to start; the server's home directory when omitted. */
  start?: string;
  confirmLabel: string;
  /** Rejects with a message to keep the browser open and show it. */
  onPick(path: string): Promise<void>;
}

export interface Crumb {
  name: string;
  path: string;
}

/** `/a/b` -> `/`, `/a`, `/a/b`; the home directory collapses to `~`. */
export function crumbs(path: string, home: string): Crumb[] {
  const under = path === home || path.startsWith(`${home}/`);
  const base = under ? home : "";
  const out: Crumb[] = under ? [{ name: "~", path: home }] : [{ name: "/", path: "/" }];
  let at = base;
  for (const part of path.slice(base.length).split("/").filter(Boolean)) {
    at = `${at}/${part}`;
    out.push({ name: part, path: at });
  }
  return out;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A directory-only browser for the server's filesystem, built to sit inside a menu panel. */
export function folderBrowser(o: FolderBrowserOptions): HTMLElement {
  const root = el("div", { class: "fb" });
  const trail = el("div", { class: "fb-trail" });
  const list = el("div", { class: "fb-list" });
  const error = el("div", { class: "fb-error" });
  const typed = el("input", {
    class: "fb-path",
    type: "text",
    placeholder: "Type a path and press Enter",
    "aria-label": "Folder path",
    spellcheck: "false",
  });
  const pick = el("button", { class: "fb-pick" });
  const newRow = el("div", { class: "fb-new" });
  let current: DirListing | null = null;

  const fail = (e: unknown): void => {
    error.textContent = messageOf(e);
  };

  async function go(path?: string): Promise<void> {
    error.textContent = "";
    try {
      const l = await listDirs(path);
      current = l;
      typed.value = l.path;
      pick.disabled = false;
      pick.textContent = o.confirmLabel;
      trail.replaceChildren(
        ...crumbs(l.path, l.home).map((c) => {
          const b = el("button", { class: "fb-crumb", text: c.name, title: c.path });
          b.addEventListener("click", () => void go(c.path));
          return b;
        }),
      );
      const rows = l.dirs.map((d) => {
        const b = el(
          "button",
          { class: "fb-dir", title: d.path },
          icon("folder"),
          el("span", { text: d.name }),
        );
        b.addEventListener("click", () => void go(d.path));
        return b;
      });
      list.replaceChildren(
        ...(l.parent === null
          ? []
          : [
              (() => {
                const up = el(
                  "button",
                  { class: "fb-dir up" },
                  icon("arrowLeft"),
                  el("span", { text: ".." }),
                );
                up.addEventListener("click", () => void go(l.parent as string));
                return up;
              })(),
            ]),
        ...rows,
        ...(rows.length === 0 ? [el("div", { class: "fb-empty", text: "No subfolders" })] : []),
      );
      trail.scrollLeft = trail.scrollWidth;
    } catch (e) {
      fail(e);
    }
  }

  function showNew(): void {
    const input = el("input", {
      class: "fb-new-input",
      type: "text",
      placeholder: "Folder name",
      "aria-label": "New folder name",
    });
    const make = async (): Promise<void> => {
      const name = input.value.trim();
      if (name === "" || current === null) return;
      try {
        const made = await makeDir(current.path, name);
        newRow.replaceChildren(newButton());
        await go(made.path);
      } catch (e) {
        fail(e);
      }
    };
    const ok = el(
      "button",
      { class: "fb-new-ok", "aria-label": "Create folder", title: "Create folder" },
      icon("check"),
    );
    ok.addEventListener("click", () => void make());
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void make();
      } else if (ev.key === "Escape") {
        ev.stopPropagation();
        newRow.replaceChildren(newButton());
      }
    });
    newRow.replaceChildren(input, ok);
    input.focus();
  }

  function newButton(): HTMLButtonElement {
    const b = el("button", { class: "fb-dir new" }, icon("plus"), el("span", { text: "New folder" }));
    b.addEventListener("click", showNew);
    return b;
  }

  typed.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    void go(typed.value);
  });
  pick.addEventListener("click", async () => {
    if (current === null) return;
    pick.disabled = true;
    error.textContent = "";
    try {
      await o.onPick(current.path);
    } catch (e) {
      fail(e);
      pick.disabled = false;
    }
  });

  newRow.append(newButton());
  pick.disabled = true;
  root.append(el("div", { class: "fb-head" }, trail), list, newRow, typed, error, pick);
  void go(o.start);
  return root;
}
