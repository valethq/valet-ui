const DEFAULT_FOCUS_MS = 420;

let focusMs: number | undefined;

/** `--dur-focus`, the length of the entrance and slide animations in page.ts, read once from the stylesheet. */
export function focusDuration(): number {
  if (focusMs !== undefined) return focusMs;
  let ms = DEFAULT_FOCUS_MS;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-focus").trim();
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) ms = raw.endsWith("ms") ? n : n * 1000;
  } catch {
    // no stylesheet to read (tests, detached document)
  }
  focusMs = ms;
  return ms;
}
