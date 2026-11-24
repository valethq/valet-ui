import { blobUrl, releaseBlobUrl } from "../api";
import { el } from "../dom";
import { iconButton } from "../icons";
import type { PartData } from "../types";

export type FileData = Extract<PartData, { type: "file" }>;

export const isImage = (d: PartData): d is FileData => d.type === "file" && d.mime.startsWith("image/");

/** The images under `root` (a message, or one gallery), in order, one per blob. */
export function galleryItems(root: Element): FileData[] {
  const seen = new Set<string>();
  const out: FileData[] = [];
  for (const n of root.querySelectorAll<HTMLElement>("[data-view]:not(.fig-act)")) {
    const { view, name, mime } = n.dataset;
    if (view === undefined || seen.has(view)) continue;
    seen.add(view);
    out.push({ type: "file", blobId: view, name: name ?? "", mime: mime ?? "image/*" });
  }
  return out;
}

// Resolved object URLs and natural sizes, so a re-render can build an image
// that is already loaded: morph() replaces <img> nodes, and a fresh node
// without a src would flash empty.
const ready = new Map<string, string>();
const sizes = new Map<string, string>();

/** An <img> for a stored blob that fades in once it has loaded. */
export function blobImage(d: FileData, cls: string): HTMLImageElement {
  const known = ready.get(d.blobId);
  const img = el("img", {
    class: known === undefined ? cls : `${cls} loaded`,
    alt: d.name,
    draggable: "false",
    decoding: "async",
    loading: "lazy",
    "data-blob": d.blobId,
  });
  if (known !== undefined) {
    img.src = known;
    return img;
  }
  img.addEventListener("load", () => {
    img.classList.add("loaded");
    const size = `${img.naturalWidth}×${img.naturalHeight}`;
    sizes.set(d.blobId, size);
    const dim = img.closest("figure")?.querySelector(".dim");
    if (dim) dim.textContent = size;
  });
  blobUrl(d.blobId)
    .then((url) => {
      ready.set(d.blobId, url);
      img.src = url;
    })
    .catch(() => {});
  return img;
}

/** Frees the object URLs of blobs no chat on screen uses; one shown again is fetched again. */
export function releaseBlobs(ids: Iterable<string>): void {
  for (const id of ids) {
    ready.delete(id);
    releaseBlobUrl(id);
  }
}

const viewAttrs = (d: FileData): Record<string, string> => ({
  "data-view": d.blobId,
  "data-name": d.name,
  "data-mime": d.mime,
});

function withAttrs<T extends HTMLElement>(node: T, attrs: Record<string, string>): T {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** A user message's images, dealt left to right like cards on a table: each
 * lands on the one before, and the deck spreads apart on hover. */
export function imageDeck(images: FileData[]): HTMLElement {
  const deck = el("div", {
    class: `deck${images.length === 1 ? " single" : ""}`,
    "data-gallery": "Your message",
    style: `--n:${images.length}`,
  });
  images.forEach((d, i) => {
    deck.append(
      el(
        "button",
        {
          class: "deck-card",
          type: "button",
          title: d.name,
          "aria-label": `View ${d.name}`,
          style: `--i:${i}`,
          ...viewAttrs(d),
        },
        blobImage(d, "media-img"),
      ),
    );
  });
  return deck;
}

/** Images the model presented: framed figures with a name/size footer. */
export function imageFigures(images: FileData[]): HTMLElement {
  const group = el("div", {
    class: `figures${images.length > 1 ? " grid" : ""}`,
    "data-gallery": "Assistant",
  });
  for (const d of images) {
    const save = withAttrs(iconButton("import", `Download ${d.name}`, "fig-act"), {
      "data-save": d.blobId,
      "data-name": d.name,
    });
    const copy = withAttrs(iconButton("copy", "Copy image", "fig-act"), { "data-copy-image": d.blobId });
    const view = withAttrs(iconButton("maximize", "View", "fig-act"), viewAttrs(d));
    group.append(
      el(
        "figure",
        { class: "part-figure" },
        el(
          "button",
          { class: "fig-pic", type: "button", "aria-label": `View ${d.name}`, ...viewAttrs(d) },
          blobImage(d, "media-img"),
        ),
        el(
          "figcaption",
          {},
          el("span", { class: "name", text: d.name, title: d.name }),
          el("span", { class: "dim", text: sizes.get(d.blobId) ?? "" }),
          el("span", { class: "acts" }, copy, save, view),
        ),
      ),
    );
  }
  return group;
}

export const saveUrl = (href: string, name: string): void => el("a", { href, download: name }).click();

export async function saveBlob(blobId: string, name: string): Promise<void> {
  saveUrl(await blobUrl(blobId), name);
}

export async function copyImage(blobId: string): Promise<void> {
  await copyImageUrl(await blobUrl(blobId));
}

/** Puts an image on the clipboard; non-PNGs are redrawn as PNG, the one type
 * every browser's clipboard accepts. */
export async function copyImageUrl(url: string): Promise<void> {
  const blob = await (await fetch(url, { credentials: "include" })).blob();
  const png =
    blob.type === "image/png"
      ? blob
      : await new Promise<Blob>((resolve, reject) => {
          createImageBitmap(blob).then((bmp) => {
            const c = el("canvas", { width: String(bmp.width), height: String(bmp.height) });
            c.getContext("2d")?.drawImage(bmp, 0, 0);
            c.toBlob((b) => (b === null ? reject(new Error("encode failed")) : resolve(b)), "image/png");
          }, reject);
        });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
