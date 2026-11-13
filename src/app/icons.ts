import { el } from "./dom";

// Lucide-style 24px stroke icons, inlined so the bundle stays dependency-free.
const PATHS = {
  send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  compose:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="4"/><path d="M9 3v18"/>',
  settings:
    '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  expand: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sparkles:
    '<path d="M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0Z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): HTMLSpanElement {
  const span = el("span", { class: "icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}

export function iconButton(name: IconName, label: string, cls = ""): HTMLButtonElement {
  const b = el("button", { class: `icon-btn ${cls}`.trim(), "aria-label": label, title: label });
  b.append(icon(name));
  return b;
}

/** A native select dressed as a pill: optional leading slot, trailing chevron. */
export function selectChip(select: HTMLSelectElement, cls: string, lead?: HTMLElement): HTMLLabelElement {
  const chip = el("label", { class: `chip ${cls}${lead === undefined ? "" : " has-lead"}` });
  if (lead !== undefined) chip.append(lead);
  chip.append(select, el("span", { class: "chevron" }, icon("chevron")));
  return chip;
}

/** A pill button: swappable leading slot, text label, trailing chevron (menu triggers). */
export function chipButton(
  cls: string,
  initialLead: HTMLElement,
  label: string,
): { button: HTMLButtonElement; text: HTMLSpanElement; lead: HTMLSpanElement } {
  const lead = el("span", { class: "lead" }, initialLead);
  const text = el("span", { class: "chip-label" });
  const button = el(
    "button",
    { class: `chip ${cls}`, "aria-label": label, title: label },
    lead,
    text,
    el("span", { class: "chevron" }, icon("chevron")),
  );
  return { button, text, lead };
}
