const DEFAULT_FOCUS_MS = 420;
const DEFAULT_EASE = "cubic-bezier(.22, 1, .36, 1)";

let focusMs: number | undefined;
let focusEase: string | undefined;

const rootToken = (name: string): string => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return ""; // no stylesheet to read (tests, detached document)
  }
};

/** `--dur-focus`, the length of the entrance and slide animations in page.ts, read once from the stylesheet. */
export function focusDuration(): number {
  if (focusMs !== undefined) return focusMs;
  const raw = rootToken("--dur-focus");
  const n = Number.parseFloat(raw);
  focusMs = Number.isFinite(n) && n > 0 ? (raw.endsWith("ms") ? n : n * 1000) : DEFAULT_FOCUS_MS;
  return focusMs;
}

/** `--ease-focus`, the curve everything eases into place on, read once from the stylesheet. */
export function focusEasing(): string {
  focusEase ??= rootToken("--ease-focus") || DEFAULT_EASE;
  return focusEase;
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Which way new content travels in: rising into place, or sliding in from the side it lives on. */
export type Way = "rise" | "fwd" | "back";

/** Plays the `.fx-in` entrance from page.ts on `node`, restarting it if it already ran: for content swapped in place. */
export function enter(node: Element, way: Way = "rise"): void {
  node.classList.remove("fx-in", "fwd", "back");
  // drop the old animation so re-adding the class restarts it; a detached node starts it on insertion anyway
  if (node.isConnected) void getComputedStyle(node).animationName;
  node.classList.add("fx-in");
  if (way !== "rise") node.classList.add(way);
}

/** Fades a block that streamed into a live message up into place. Runs outside the class list, so a later patch of the node's attributes cannot cut it short. */
export function streamIn(node: Element): void {
  if (reducedMotion() || typeof node.animate !== "function") return;
  node.animate(
    [
      { opacity: 0, filter: "blur(3px)", transform: "translateY(4px)" },
      { opacity: 1, filter: "blur(0)", transform: "none" },
    ],
    { duration: focusDuration() * 0.7, easing: focusEasing() },
  );
}

const glides = new WeakMap<Element, Animation>();

/** A FLIP: `node` has just moved in the layout; it starts from `fromTop` (its old viewport top) and eases into place. */
export function glide(node: HTMLElement, fromTop: number): void {
  if (node.isConnected !== true || reducedMotion()) return;
  const dy = fromTop - node.getBoundingClientRect().top;
  glides.get(node)?.cancel();
  if (Math.abs(dy) < 1) return;
  const a = node.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
    duration: focusDuration(),
    easing: focusEasing(),
  });
  glides.set(node, a);
}

/** Fades `node` out while the space it held closes up (`y` for stacked rows, `x` for chips in a line), then removes it. */
export function collapse(node: HTMLElement, axis: "x" | "y" = "y", done?: () => void): void {
  const parent = node.parentElement;
  const finish = (): void => {
    node.remove();
    done?.();
  };
  if (parent == null || node.isConnected !== true || reducedMotion()) {
    finish();
    return;
  }
  const style = getComputedStyle(parent);
  const gap = Number.parseFloat(axis === "y" ? style.rowGap : style.columnGap) || 0;
  const size = axis === "y" ? "height" : "width";
  const margin = axis === "y" ? "marginBottom" : "marginRight";
  const from = axis === "y" ? node.offsetHeight : node.offsetWidth;
  node.style.overflow = "hidden";
  node.style.pointerEvents = "none";
  node.style.flexShrink = "0";
  const a = node.animate(
    [
      { [size]: `${from}px`, [margin]: "0px", opacity: 1, filter: "blur(0)" },
      { [size]: "0px", [margin]: `${-gap}px`, opacity: 0, filter: "blur(4px)" },
    ],
    { duration: focusDuration() * 0.75, easing: focusEasing() },
  );
  a.onfinish = finish;
}
