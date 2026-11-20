import { el } from "../dom";
import { icon, iconButton } from "../icons";
import { collapse } from "../motion";
import type { PartInput } from "../types";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface Attached {
  file: File;
  /** Resolves to the core blob id once the upload lands; rejects if it fails. */
  blob: Promise<string>;
  preview: string | null;
  done: boolean;
}

export interface AttachmentsOptions {
  upload(file: File): Promise<string>;
  onError(message: string): void;
  onChange(): void;
}

export const filePart = (blobId: string, file: File): PartInput => ({
  type: "file",
  blobId,
  name: file.name,
  mime: file.type || "application/octet-stream",
});

export function createAttachments(opts: AttachmentsOptions) {
  const row = el("div", { class: "attach-row" });
  row.style.display = "none";
  let items: Attached[] = [];
  /** One chip per attachment for its lifetime, so only new chips play the entrance. */
  const chips = new Map<Attached, HTMLElement>();
  const hideIfEmpty = (): void => {
    if (chips.size === 0) row.style.display = "none";
  };

  function render(): void {
    for (const [a, node] of chips) {
      if (items.includes(a)) continue;
      chips.delete(a);
      collapse(node, "x", hideIfEmpty);
    }
    for (const a of items) {
      let node = chips.get(a);
      if (node === undefined) {
        node = chip(a);
        chips.set(a, node);
        row.append(node);
      }
      if (a.done) node.classList.remove("pending");
    }
    if (items.length > 0) row.style.display = "";
    else hideIfEmpty();
    opts.onChange();
  }

  function chip(a: Attached): HTMLElement {
    const close = iconButton("close", "Remove attachment", "attach-remove");
    close.addEventListener("click", () => drop([a]));
    const lead =
      a.preview === null ? icon("file") : el("img", { class: "attach-thumb", alt: "", src: a.preview });
    return el(
      "div",
      { class: `attach-chip${a.done ? "" : " pending"}` },
      lead,
      el("span", { class: "attach-name", text: a.file.name }),
      close,
    );
  }

  function add(files: File[]): void {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        opts.onError(`${file.name} is larger than 20 MB`);
        continue;
      }
      const a: Attached = {
        file,
        blob: opts.upload(file),
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        done: false,
      };
      a.blob.then(
        () => {
          a.done = true;
          render();
        },
        (e: unknown) => {
          drop([a]);
          opts.onError(e instanceof Error ? e.message : "upload failed");
        },
      );
      items.push(a);
    }
    render();
  }

  function drop(list: Attached[]): void {
    items = items.filter((a) => !list.includes(a));
    for (const a of list) if (a.preview !== null) URL.revokeObjectURL(a.preview);
    render();
  }

  return { row, add, drop, list: (): Attached[] => items.slice() };
}
