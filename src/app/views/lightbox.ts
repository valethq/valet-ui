import { el, leave } from "../dom";
import { iconButton } from "../icons";
import { blobImage, copyImage, type FileData, saveBlob } from "./media";

export interface LightboxItem {
  file: FileData;
  /** The thumbnail it opened from; the image grows out of it and returns to it. */
  thumb: HTMLElement | null;
}

const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "ease";
const MAX_ZOOM = 8;

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The images under `root` (a message, or one gallery), in order, one per blob. */
export function galleryItems(root: Element): LightboxItem[] {
  const seen = new Set<string>();
  const out: LightboxItem[] = [];
  for (const n of root.querySelectorAll<HTMLElement>("[data-view]:not(.fig-act)")) {
    const { view, name, mime } = n.dataset;
    if (view === undefined || seen.has(view)) continue;
    seen.add(view);
    out.push({ file: { type: "file", blobId: view, name: name ?? "", mime: mime ?? "image/*" }, thumb: n });
  }
  return out;
}

let openBox: { close(): void } | null = null;

export function openLightbox(
  items: LightboxItem[],
  start: number,
  source: string,
  onError: (message: string) => void,
): void {
  openBox?.close();
  if (items.length === 0) return;
  let index = Math.max(0, Math.min(items.length - 1, start));
  let zoom = { s: 1, x: 0, y: 0 };
  const returnFocus = document.activeElement as HTMLElement | null;

  const name = el("span", { class: "lb-name" });
  const count = el("span", { class: "lb-count" });
  const oneToOne = iconButton("expand", "Actual size", "lb-btn lb-1to1");
  oneToOne.replaceChildren("1:1");
  const copy = iconButton("copy", "Copy image", "lb-btn");
  const save = iconButton("import", "Download", "lb-btn");
  const close = iconButton("close", "Close", "lb-btn");
  const stage = el("div", { class: "lb-stage" });
  const film = el("div", { class: "lb-film" });
  const prev = iconButton("chevronLeft", "Previous image", "lb-nav lb-prev");
  const next = iconButton("chevronRight", "Next image", "lb-nav lb-next");
  const box = el(
    "div",
    { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Image viewer" },
    el(
      "div",
      { class: "lb-top" },
      name,
      count,
      el("span", { class: "lb-src", text: source }),
      el("span", { class: "lb-acts" }, oneToOne, copy, save, close),
    ),
    stage,
  );
  if (items.length > 1) {
    box.append(prev, next, film);
    items.forEach((it, i) => {
      const b = el(
        "button",
        { class: "lb-thumb", type: "button", "aria-label": it.file.name },
        blobImage(it.file, "media-img"),
      );
      b.addEventListener("click", () => go(i));
      film.append(b);
    });
  }

  let img = el("img");
  const current = (): LightboxItem => items[index] as LightboxItem;

  function show(dir: 0 | 1 | -1): void {
    const it = current();
    zoom = { s: 1, x: 0, y: 0 };
    const fresh = blobImage(it.file, "lb-img");
    if (dir !== 0) fresh.classList.add(dir > 0 ? "from-next" : "from-prev");
    fresh.addEventListener("load", syncOneToOne);
    img.replaceWith(fresh);
    img = fresh;
    if (!stage.contains(img)) stage.append(img);
    applyZoom(false);
    name.textContent = it.file.name;
    name.title = it.file.name;
    count.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : "";
    [...film.children].forEach((t, i) => {
      t.classList.toggle("on", i === index);
      if (i === index) (t as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    prev.disabled = index === 0;
    next.disabled = index === items.length - 1;
    syncOneToOne();
  }

  function go(i: number): void {
    if (i === index || i < 0 || i >= items.length) return;
    const dir = i > index ? 1 : -1;
    index = i;
    show(dir);
  }

  const fitScale = (): number => (img.clientWidth > 0 ? img.naturalWidth / img.clientWidth : 1);

  function syncOneToOne(): void {
    const native = fitScale();
    oneToOne.hidden = !(native > 1.05);
    oneToOne.classList.toggle("on", Math.abs(zoom.s - native) < 0.01);
    box.classList.toggle("zoomed", zoom.s > 1);
  }

  function clampPan(): void {
    const w = img.clientWidth * zoom.s;
    const h = img.clientHeight * zoom.s;
    const mx = Math.max(0, (w - stage.clientWidth) / 2);
    const my = Math.max(0, (h - stage.clientHeight) / 2);
    zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
    zoom.y = Math.max(-my, Math.min(my, zoom.y));
  }

  function applyZoom(animate: boolean): void {
    img.classList.toggle("instant", !animate);
    img.style.transform = zoom.s === 1 ? "" : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
    syncOneToOne();
  }

  /** Zooms to scale `s`, keeping the image point under (cx, cy) still. */
  function zoomAt(s: number, cx: number, cy: number, animate: boolean): void {
    const next = Math.max(1, Math.min(MAX_ZOOM, s));
    const r = stage.getBoundingClientRect();
    const mx = cx - (r.left + r.width / 2);
    const my = cy - (r.top + r.height / 2);
    const k = next / zoom.s;
    zoom = { s: next, x: mx - k * (mx - zoom.x), y: my - k * (my - zoom.y) };
    if (next === 1) zoom = { s: 1, x: 0, y: 0 };
    clampPan();
    applyZoom(animate);
  }

  let drag: { id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null = null;
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.target !== img || ev.button !== 0) return;
    drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, x: zoom.x, y: zoom.y, moved: false };
    img.setPointerCapture(ev.pointerId);
  });
  stage.addEventListener("pointermove", (ev) => {
    if (drag === null || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (zoom.s === 1) return;
    box.classList.add("panning");
    zoom.x = drag.x + dx;
    zoom.y = drag.y + dy;
    clampPan();
    applyZoom(false);
  });
  stage.addEventListener("pointerup", (ev) => {
    if (drag === null || ev.pointerId !== drag.id) return;
    const wasDrag = drag.moved;
    drag = null;
    box.classList.remove("panning");
    if (wasDrag) return;
    if (zoom.s > 1) zoomAt(1, ev.clientX, ev.clientY, true);
    else zoomAt(Math.max(2.5, fitScale()), ev.clientX, ev.clientY, true);
  });
  stage.addEventListener("click", (ev) => {
    if (ev.target === stage) dismiss();
  });
  stage.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      zoomAt(zoom.s * Math.exp(-ev.deltaY * 0.0022), ev.clientX, ev.clientY, false);
    },
    { passive: false },
  );

  oneToOne.addEventListener("click", () => {
    const r = stage.getBoundingClientRect();
    const native = fitScale();
    const target = Math.abs(zoom.s - native) < 0.01 ? 1 : native;
    zoom = { s: zoom.s, x: 0, y: 0 };
    zoomAt(target, r.left + r.width / 2, r.top + r.height / 2, true);
  });
  copy.addEventListener("click", () => {
    copyImage(current().file.blobId).then(
      () => flash(copy),
      () => onError("Couldn't copy the image"),
    );
  });
  save.addEventListener("click", () => {
    saveBlob(current().file.blobId, current().file.name).catch(() => onError("Download failed"));
  });
  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  close.addEventListener("click", () => dismiss());

  function onKey(ev: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      Escape: () => (zoom.s > 1 ? zoomAt(1, 0, 0, true) : dismiss()),
      ArrowLeft: () => go(index - 1),
      ArrowRight: () => go(index + 1),
      "0": () => zoomAt(1, 0, 0, true),
    };
    const fn = keys[ev.key];
    if (fn === undefined) return;
    ev.preventDefault();
    ev.stopPropagation();
    fn();
  }

  /** The visible rect of the thumbnail for the current image, if it is on screen. */
  function thumbRect(): DOMRect | null {
    const t = current().thumb;
    if (t === null || !t.isConnected) return null;
    const r = t.getBoundingClientRect();
    const onScreen = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    return onScreen ? r : null;
  }

  /** Transform that maps the lightbox image onto `from`. */
  function flipFrom(from: DOMRect): string {
    const to = img.getBoundingClientRect();
    const s = Math.max(from.width / to.width, from.height / to.height);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  }

  let hidden: HTMLElement | null = null;
  const hideThumb = (): void => {
    hidden = current().thumb;
    hidden?.classList.add("lb-source");
  };
  const showThumb = (): void => {
    hidden?.classList.remove("lb-source");
    hidden = null;
  };

  async function enter(): Promise<void> {
    const from = thumbRect();
    if (from === null || reducedMotion()) {
      box.classList.add("pop");
      return;
    }
    await img.decode().catch(() => {});
    if (!box.isConnected || img.clientWidth === 0) {
      box.classList.add("pop");
      return;
    }
    hideThumb();
    const a = img.animate([{ transform: flipFrom(from), borderRadius: "24px" }, { transform: "none" }], {
      duration: 420,
      easing: token("--ease-focus"),
    });
    a.finished.then(showThumb, showThumb);
  }

  let closing = false;
  function dismiss(): void {
    if (closing) return;
    closing = true;
    document.removeEventListener("keydown", onKey, true);
    openBox = null;
    returnFocus?.focus?.({ preventScroll: true });
    const to = thumbRect();
    box.classList.add("leaving");
    if (to === null || reducedMotion() || zoom.s > 1) {
      leave(box, 380);
      return;
    }
    hideThumb();
    const a = img.animate(
      [{ transform: "none" }, { transform: flipFrom(to), borderRadius: "24px", opacity: 0.6 }],
      {
        duration: 260,
        easing: token("--ease-exit"),
        fill: "forwards",
      },
    );
    const done = (): void => {
      showThumb();
      box.remove();
    };
    a.finished.then(done, done);
  }

  document.body.append(box);
  show(0);
  document.addEventListener("keydown", onKey, true);
  close.focus({ preventScroll: true });
  openBox = { close: dismiss };
  void enter();
}

function flash(btn: HTMLButtonElement): void {
  btn.classList.add("done");
  setTimeout(() => btn.classList.remove("done"), 1200);
}
