import { el } from "../dom";

const SWIPE = 50;
const STEP = 1.5;

/** An image fitted to its box that zooms around the pointer and pans within its edges. */
export interface ImageStage {
  readonly node: HTMLElement;
  readonly img: HTMLImageElement;
  /** Zoom as a share of the image's real pixels: 1 is actual size. */
  percent(): number;
  zoomed(): boolean;
  /** Steps zoom in (1) or out (-1) around the centre. */
  step(dir: 1 | -1): void;
  fit(): void;
  /** Fitted to actual size and back. */
  toggleActual(): void;
  /** Zoom, fit and pan keys; true when the key was used. */
  key(ev: KeyboardEvent): boolean;
  /** Zoom changed, or the image loaded or was resized. */
  onChange: () => void;
  /** A horizontal swipe or trackpad swipe while fitted: 1 is the next image. */
  onSwipe: (dir: 1 | -1) => void;
  onError: () => void;
}

export function imageStage(src: string | Promise<string>, alt: string): ImageStage {
  const img = el("img", { class: "fv-img", alt, draggable: "false", decoding: "async" });
  const node = el("div", { class: "fv-stage", tabindex: "-1" }, img);
  // s is the scale over the fitted size, x/y the pan in px from centre.
  let z = { s: 1, x: 0, y: 0 };

  const native = (): number => (img.clientWidth > 0 ? img.naturalWidth / img.clientWidth : 1);
  const maxScale = (): number => Math.max(8, native() * 4);

  const stage: ImageStage = {
    node,
    img,
    percent: () => z.s / native(),
    zoomed: () => z.s > 1.001,
    step: (dir) => center(z.s * (dir > 0 ? STEP : 1 / STEP)),
    fit: () => center(1),
    toggleActual: () => center(Math.abs(z.s - native()) < 0.01 || native() <= 1.01 ? 1 : native()),
    key,
    onChange: () => {},
    onSwipe: () => {},
    onError: () => {},
  };

  function clamp(): void {
    const mx = Math.max(0, (img.clientWidth * z.s - node.clientWidth) / 2);
    const my = Math.max(0, (img.clientHeight * z.s - node.clientHeight) / 2);
    z.x = Math.max(-mx, Math.min(mx, z.x));
    z.y = Math.max(-my, Math.min(my, z.y));
  }

  function apply(animate: boolean): void {
    img.classList.toggle("instant", !animate);
    img.style.transform = z.s === 1 ? "" : `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    node.classList.toggle("zoomed", stage.zoomed());
    stage.onChange();
  }

  /** Zooms to scale `s`, keeping the image point under (cx, cy) still. */
  function zoomAt(s: number, cx: number, cy: number, animate: boolean): void {
    const next = Math.max(1, Math.min(maxScale(), s));
    const r = node.getBoundingClientRect();
    const mx = cx - (r.left + r.width / 2);
    const my = cy - (r.top + r.height / 2);
    const k = next / z.s;
    z = next < 1.001 ? { s: 1, x: 0, y: 0 } : { s: next, x: mx - k * (mx - z.x), y: my - k * (my - z.y) };
    clamp();
    apply(animate);
  }

  function center(s: number): void {
    const r = node.getBoundingClientRect();
    zoomAt(s, r.left + r.width / 2, r.top + r.height / 2, true);
  }

  function panBy(dx: number, dy: number): void {
    z.x += dx;
    z.y += dy;
    clamp();
    apply(false);
  }

  function key(ev: KeyboardEvent): boolean {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return false;
    const pan = stage.zoomed() ? 60 : 0;
    const keys: Record<string, () => void> = {
      "+": () => stage.step(1),
      "=": () => stage.step(1),
      "-": () => stage.step(-1),
      "0": () => stage.fit(),
      "1": () => stage.toggleActual(),
      ...(pan === 0
        ? {}
        : {
            ArrowLeft: () => panBy(pan, 0),
            ArrowRight: () => panBy(-pan, 0),
            ArrowUp: () => panBy(0, pan),
            ArrowDown: () => panBy(0, -pan),
          }),
    };
    const fn = keys[ev.key];
    if (fn === undefined) return false;
    ev.preventDefault();
    fn();
    return true;
  }

  // Pointers: one drags (pan when zoomed, swipe when fitted), two pinch; a tap without movement toggles zoom.
  const pts = new Map<number, { x: number; y: number }>();
  let gesture: { sx: number; sy: number; x: number; y: number; moved: boolean; pinched: boolean } | null =
    null;
  let pinch: { d: number; s: number; mx: number; my: number } | null = null;
  const mid = () => {
    const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  node.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    node.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 1)
      gesture = { sx: ev.clientX, sy: ev.clientY, x: z.x, y: z.y, moved: false, pinched: false };
    if (pts.size === 2) {
      const m = mid();
      pinch = { d: m.d, s: z.s, mx: m.mx, my: m.my };
      if (gesture !== null) gesture.pinched = true;
    }
  });
  node.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch !== null && pts.size >= 2) {
      const m = mid();
      zoomAt(pinch.s * (m.d / Math.max(1, pinch.d)), m.mx, m.my, false);
      panBy(m.mx - pinch.mx, m.my - pinch.my);
      pinch = { d: m.d, s: z.s, mx: m.mx, my: m.my };
      return;
    }
    if (gesture === null) return;
    const dx = ev.clientX - gesture.sx;
    const dy = ev.clientY - gesture.sy;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    if (!stage.zoomed()) return;
    node.classList.add("panning");
    z.x = gesture.x + dx;
    z.y = gesture.y + dy;
    clamp();
    apply(false);
  });
  const release = (ev: PointerEvent): void => {
    if (!pts.delete(ev.pointerId)) return;
    if (pts.size < 2) pinch = null;
    if (pts.size > 0 || gesture === null) return;
    const g = gesture;
    gesture = null;
    node.classList.remove("panning");
    if (ev.type === "pointercancel" || g.pinched) return;
    const dx = ev.clientX - g.sx;
    const dy = ev.clientY - g.sy;
    if (g.moved) {
      if (!stage.zoomed() && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5)
        stage.onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (stage.zoomed()) zoomAt(1, ev.clientX, ev.clientY, true);
    else zoomAt(Math.max(2, native()), ev.clientX, ev.clientY, true);
  };
  node.addEventListener("pointerup", release);
  node.addEventListener("pointercancel", release);

  // Wheel: a mouse notch or a trackpad pinch (ctrlKey) zooms at the pointer; trackpad scrolling pans when zoomed
  // and, sideways while fitted, swipes one image per gesture.
  let swipe = { sum: 0, lock: 0, last: 0 };
  node.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const unit =
        ev.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? 400
            : 1;
      const dx = ev.deltaX * unit;
      const dy = ev.deltaY * unit;
      const notch =
        ev.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 50);
      if (ev.ctrlKey || notch) {
        zoomAt(z.s * Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0025)), ev.clientX, ev.clientY, false);
        return;
      }
      if (stage.zoomed()) {
        const swap = ev.shiftKey && dx === 0;
        panBy(-(swap ? dy : dx), swap ? 0 : -dy);
        return;
      }
      if (Math.abs(dx) <= Math.abs(dy)) return;
      const now = performance.now();
      if (now - swipe.last > 120) swipe.sum = 0;
      swipe.last = now;
      if (now < swipe.lock) {
        swipe.lock = Math.max(swipe.lock, now + 120);
        return;
      }
      swipe.sum += dx;
      if (Math.abs(swipe.sum) < SWIPE) return;
      stage.onSwipe(swipe.sum > 0 ? 1 : -1);
      swipe = { sum: 0, lock: now + 300, last: now };
    },
    { passive: false },
  );

  img.addEventListener("load", () => {
    img.classList.add("loaded");
    stage.onChange();
  });
  img.addEventListener("error", () => stage.onError());
  new ResizeObserver(() => {
    clamp();
    apply(false);
  }).observe(node);
  void Promise.resolve(src).then(
    (url) => {
      img.src = url;
    },
    () => stage.onError(),
  );
  return stage;
}
