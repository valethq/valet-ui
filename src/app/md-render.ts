// DOM builder for the markdown tree. Everything goes through textContent, so
// untrusted text can never become markup.

import type { Block, ListItem } from "./md-blocks";
import type { Inline } from "./md-inline";
import { baseName, lineLabel } from "./file-ref";
import { icon, iconButton } from "./icons";
import { type MarkdownOptions, parseMarkdown } from "./md-blocks";

const plainText = (inlines: Inline[]): string | null =>
  inlines.every((n) => n.type === "text" || n.type === "code")
    ? inlines.map((n) => (n as { text: string }).text).join("")
    : null;

/** A file chip; the chat and the viewer open it from `data-path` / `data-line` / `data-end`. */
function renderFile(inline: Extract<Inline, { type: "file" }>, parent: HTMLElement): void {
  const { ref } = inline;
  const a = document.createElement("a");
  a.setAttribute("role", "button");
  a.setAttribute("tabindex", "0");
  a.setAttribute("data-path", ref.path);
  if (ref.line !== undefined) a.setAttribute("data-line", String(ref.line));
  if (ref.end !== undefined) a.setAttribute("data-end", String(ref.end));
  a.title = `${ref.path}${lineLabel(ref)}`;
  a.append(icon("file"));
  const plain = plainText(inline.children);
  if (inline.auto || plain !== null) {
    a.className = inline.auto || !/\s/.test(plain as string) ? "file-link mono" : "file-link";
    const label = document.createElement("span");
    label.textContent = inline.auto ? baseName(ref.path) : (plain as string);
    a.append(label);
    if (inline.auto && ref.line !== undefined) {
      const ln = document.createElement("span");
      ln.className = "ln";
      ln.textContent = lineLabel(ref);
      a.append(ln);
    }
  } else {
    a.className = "file-link";
    const label = document.createElement("span");
    renderInlines(inline.children, label);
    a.append(label);
  }
  parent.append(a);
}

function renderInlines(inlines: Inline[], parent: HTMLElement): void {
  for (const inline of inlines) {
    switch (inline.type) {
      case "text":
        parent.append(document.createTextNode(inline.text));
        break;
      case "code": {
        const code = document.createElement("code");
        code.className = "inline";
        code.textContent = inline.text;
        parent.append(code);
        break;
      }
      case "link": {
        const a = document.createElement("a");
        a.href = inline.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (inline.title !== undefined) a.title = inline.title;
        renderInlines(inline.children, a);
        parent.append(a);
        break;
      }
      case "file":
        renderFile(inline, parent);
        break;
      case "footnote": {
        const sup = document.createElement("sup");
        sup.textContent = String(inline.n);
        parent.append(sup);
        break;
      }
      default: {
        const node = document.createElement(inline.type === "strong" ? "strong" : inline.type);
        renderInlines(inline.children, node);
        parent.append(node);
      }
    }
  }
}

function renderItem(item: ListItem, li: HTMLElement): void {
  if (item.checked !== null) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = true;
    box.checked = item.checked;
    box.style.margin = "0 6px 0 0";
    li.style.listStyle = "none";
    li.append(box);
  }
  const [head, ...rest] = item.children;
  if (head?.type === "p") {
    renderInlines(head.children, li);
    renderBlocks(rest, li);
  } else {
    renderBlocks(item.children, li);
  }
}

function renderList(block: Extract<Block, { type: "ul" | "ol" }>, parent: HTMLElement): void {
  const list = document.createElement(block.type);
  if (block.type === "ol" && block.start !== 1) list.setAttribute("start", String(block.start));
  for (const item of block.items) {
    const li = document.createElement("li");
    renderItem(item, li);
    list.append(li);
  }
  parent.append(list);
}

function renderTable(block: Extract<Block, { type: "table" }>, parent: HTMLElement): void {
  const cell = (tag: "th" | "td", cells: Inline[], i: number): HTMLElement => {
    const node = document.createElement(tag);
    const a = block.align[i];
    if (a === "center") node.className = "ta-c";
    else if (a === "right") node.className = "ta-r";
    renderInlines(cells, node);
    return node;
  };
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  block.head.forEach((cells, i) => {
    headRow.append(cell("th", cells, i));
  });
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of block.rows) {
    const tr = document.createElement("tr");
    row.forEach((cells, i) => {
      tr.append(cell("td", cells, i));
    });
    tbody.append(tr);
  }
  const wrap = document.createElement("div");
  wrap.className = "md-table";
  const table = document.createElement("table");
  table.append(thead, tbody);
  wrap.append(table);
  parent.append(wrap);
}

function copyCode(btn: HTMLButtonElement, text: string): void {
  const flash = (name: "check" | "close", label: string): void => {
    btn.replaceChildren(icon(name));
    btn.title = label;
    btn.setAttribute("aria-label", label);
    setTimeout(() => {
      btn.replaceChildren(icon("copy"));
      btn.title = "Copy code";
      btn.setAttribute("aria-label", "Copy code");
    }, 1500);
  };
  navigator.clipboard.writeText(text).then(
    () => flash("check", "Copied"),
    () => flash("close", "Copy failed"),
  );
}

function renderBlocks(blocks: Block[], parent: HTMLElement): void {
  for (const block of blocks) {
    switch (block.type) {
      case "pre": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = block.text;
        pre.append(code);
        const wrap = document.createElement("div");
        wrap.className = "code-block";
        const btn = iconButton("copy", "Copy code", "code-copy");
        btn.addEventListener("click", () => copyCode(btn, block.text));
        wrap.append(pre, btn);
        parent.append(wrap);
        break;
      }
      case "h": {
        const p = document.createElement("p");
        p.className = `md-h md-h${block.level}`;
        renderInlines(block.children, p);
        parent.append(p);
        break;
      }
      case "ul":
      case "ol":
        renderList(block, parent);
        break;
      case "quote": {
        const div = document.createElement("div");
        div.className = "md-quote";
        renderBlocks(block.children, div);
        parent.append(div);
        break;
      }
      case "table":
        renderTable(block, parent);
        break;
      case "footnotes": {
        const ol = document.createElement("ol");
        for (const note of block.items) {
          const li = document.createElement("li");
          renderItem({ checked: null, children: note }, li);
          ol.append(li);
        }
        parent.append(document.createElement("hr"), ol);
        break;
      }
      case "hr":
        parent.append(document.createElement("hr"));
        break;
      default: {
        const p = document.createElement("p");
        renderInlines(block.children, p);
        parent.append(p);
      }
    }
  }
}

export function renderMarkdown(text: string, options?: MarkdownOptions): HTMLElement {
  const root = document.createElement("div");
  renderBlocks(parseMarkdown(text, options), root);
  return root;
}
