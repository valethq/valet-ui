import { el } from "../dom";
import { emoji } from "../emoji";

interface Query {
  start: number;
  end: number;
  name: string;
}

function shortcodeAt(text: string, caret: number): Query | null {
  const prefix = text.slice(0, caret);
  const match = /(?:^|[\s([{"'*_~]):([a-z0-9_+-]{1,64})$/i.exec(prefix);
  if (match?.[1] === undefined) return null;
  const tail = /^[a-z0-9_+-]*:?/i.exec(text.slice(caret))?.[0] ?? "";
  return { start: caret - match[1].length - 1, end: caret + tail.length, name: match[1] };
}

function matches(name: string): [string, string][] {
  const query = name.toLowerCase();
  const exact: [string, string][] = [];
  const prefixes: [string, string][] = [];
  const words: [string, string][] = [];
  for (const [name, glyph] of emoji) {
    if (name === query) exact.push([name, glyph]);
    else if (name.startsWith(query)) prefixes.push([name, glyph]);
    else if (name.includes(`_${query}`) || name.includes(`-${query}`)) words.push([name, glyph]);
  }
  prefixes.sort(([a], [b]) => a.length - b.length);
  return [...exact, ...prefixes, ...words].slice(0, 12);
}

// spec-gap: composer autocomplete is a UI convention.
export function emojiSuggestions(textarea: HTMLTextAreaElement) {
  const title = el("div", { class: "menu-title", id: "emoji-suggestions-title" });
  const list = el("div", {
    class: "menu-body",
    id: "emoji-suggestions",
    role: "listbox",
    "aria-labelledby": title.id,
  });
  const panel = el("div", { class: "menu emoji-suggestions", hidden: "" }, title, list);
  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-controls", list.id);
  let query: Query | null = null;
  let active = 0;
  let options: HTMLButtonElement[] = [];
  let composing = false;

  function close(): void {
    panel.hidden = true;
    textarea.removeAttribute("aria-activedescendant");
  }

  function select(index: number, scroll = false): void {
    active = index;
    for (const [i, option] of options.entries()) option.setAttribute("aria-selected", String(i === active));
    const option = options[active];
    if (option === undefined) return;
    textarea.setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }

  function insert(name: string): void {
    if (query === null) return;
    textarea.setRangeText(`:${name}:`, query.start, query.end, "end");
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function update(): void {
    if (composing || document.activeElement !== textarea) return;
    const caret = textarea.selectionEnd;
    const next = textarea.selectionStart === caret ? shortcodeAt(textarea.value, caret) : null;
    if (next?.start === query?.start && next?.end === query?.end && next?.name === query?.name) return;
    query = next;
    const results = query === null ? [] : matches(query.name);
    if (query === null || results.length === 0) {
      close();
      return;
    }
    title.textContent = `Emoji matching :${query.name}`;
    options = results.map(([name, glyph], i) => {
      const option = el(
        "button",
        { class: "menu-item", id: `emoji-suggestion-${i}`, type: "button", role: "option", tabindex: "-1" },
        el("span", { class: "emoji-glyph", "aria-hidden": "true", text: glyph }),
        el("span", { class: "menu-label", text: `:${name}:` }),
      );
      option.addEventListener("mousedown", (ev) => ev.preventDefault());
      option.addEventListener("click", () => insert(name));
      return option;
    });
    list.replaceChildren(...options);
    list.scrollTop = 0;
    panel.hidden = false;
    select(0);
  }

  function reset(): void {
    if (query === null) return;
    query = null;
    close();
  }

  textarea.addEventListener("input", (ev) => {
    if (!(ev as InputEvent).isComposing) update();
  });
  textarea.addEventListener("compositionstart", () => {
    composing = true;
    reset();
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    update();
  });
  textarea.addEventListener("click", update);
  textarea.addEventListener("selectionchange", update);
  textarea.addEventListener("blur", reset);

  return {
    panel,
    reset,
    keydown(ev: KeyboardEvent): boolean {
      if (panel.hidden || ev.isComposing || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey)
        return false;
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowDown") select((active + 1) % options.length, true);
      else if (ev.key === "ArrowUp") select((active + options.length - 1) % options.length, true);
      else if (ev.key === "Enter" || ev.key === "Tab") options[active]?.click();
      else return false;
      ev.preventDefault();
      return true;
    },
  };
}
