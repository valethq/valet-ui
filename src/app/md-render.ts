// DOM builder for the markdown tree. Everything goes through textContent, so
// untrusted text can never become markup.

import type { Block, ListItem } from "./md-blocks";
import type { Inline } from "./md-inline";
import { parseMarkdown } from "./md-blocks";

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

function renderBlocks(blocks: Block[], parent: HTMLElement): void {
  for (const block of blocks) {
    switch (block.type) {
      case "pre": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = block.text;
        pre.append(code);
        parent.append(pre);
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

export function renderMarkdown(text: string): HTMLElement {
  const root = document.createElement("div");
  renderBlocks(parseMarkdown(text), root);
  return root;
}
