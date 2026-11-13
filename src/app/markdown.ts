// Minimal safe markdown: headings, lists, quotes, rules, paragraphs, fenced
// code blocks, and inline code/bold/italic/strike/links. parseMarkdown is pure
// (unit-tested); renderMarkdown builds DOM via textContent only, so untrusted
// text can never become markup.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { type: "p"; children: Inline[] }
  | { type: "pre"; text: string }
  | { type: "h"; level: number; children: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; start: number; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "table"; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] }
  | { type: "hr" };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const BARE_URL = /^https?:\/\/[^\s<>"']+/;
const TRAILING_PUNCT = /[.,;:!?'")\]]+$/;

const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = (): void => {
    if (text !== "") {
      out.push({ type: "text", text });
      text = "";
    }
  };
  const at = (re: RegExp, i: number): RegExpExecArray | null => re.exec(s.slice(i));

  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    let m: RegExpExecArray | null = null;
    let node: Inline | null = null;
    let tail = "";

    if (c === "`") {
      m = at(/^`([^`\n]+)`/, i);
      if (m !== null) node = { type: "code", text: m[1] as string };
    } else if (c === "[") {
      m = at(/^\[([^\]\n]+)\]\(([^)\n]+)\)/, i);
      if (m !== null && SAFE_HREF.test((m[2] as string).trim())) {
        node = { type: "link", href: (m[2] as string).trim(), children: parseInline(m[1] as string) };
      }
      // Unsafe schemes stay literal: node is null so the whole match is
      // appended to text unchanged below.
    } else if (c === "h" && !isWord(s[i - 1])) {
      m = at(BARE_URL, i);
      if (m !== null) {
        const url = (m[0] as string).replace(TRAILING_PUNCT, "");
        node = { type: "link", href: url, children: [{ type: "text", text: url }] };
        tail = m[0].slice(url.length);
      }
    } else if (c === "*") {
      if (s.startsWith("**", i)) {
        m = at(/^\*\*([\s\S]+?)\*\*/, i);
        if (m !== null) node = { type: "strong", children: parseInline(m[1] as string) };
      } else {
        m = at(/^\*([^*\n]+)\*/, i);
        if (m !== null) node = { type: "em", children: parseInline(m[1] as string) };
      }
    } else if (c === "_") {
      if (s.startsWith("__", i)) {
        m = at(/^__([\s\S]+?)__/, i);
        if (m !== null) node = { type: "strong", children: parseInline(m[1] as string) };
      } else if (!isWord(s[i - 1])) {
        m = at(/^_([^_\n]+)_/, i);
        if (m !== null && !isWord(s[i + m[0].length])) {
          node = { type: "em", children: parseInline(m[1] as string) };
        } else {
          m = null;
        }
      }
    } else if (c === "~" && s.startsWith("~~", i)) {
      m = at(/^~~([\s\S]+?)~~/, i);
      if (m !== null) node = { type: "del", children: parseInline(m[1] as string) };
    }

    if (m !== null) {
      flush();
      if (node !== null) out.push(node);
      else text += m[0];
      i += m[0].length;
      if (tail !== "") text += tail;
    } else {
      text += c;
      i++;
    }
  }
  flush();
  return out;
}

type Line =
  | { kind: "h"; level: number; body: string }
  | { kind: "ul"; body: string }
  | { kind: "ol"; n: number; body: string }
  | { kind: "quote"; body: string }
  | { kind: "hr" }
  | { kind: "text"; body: string };

function classify(line: string): Line {
  const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?[ \t]*$/.exec(line);
  if (h !== null) return { kind: "h", level: (h[1] as string).length, body: h[2] ?? "" };
  if (/^ {0,3}(-{3,}|\*{3,})[ \t]*$/.test(line)) return { kind: "hr" };
  const ul = /^ {0,3}[-*+][ \t]+(.*)$/.exec(line);
  if (ul !== null) return { kind: "ul", body: ul[1] as string };
  const ol = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/.exec(line);
  if (ol !== null) return { kind: "ol", n: Number(ol[1]), body: ol[2] as string };
  const quote = /^ {0,3}>[ \t]?(.*)$/.exec(line);
  if (quote !== null) return { kind: "quote", body: quote[1] as string };
  return { kind: "text", body: line };
}

const DELIM_CELL = /^:?-{1,}:?$/;

/** Splits a table row on unescaped pipes; leading/trailing pipes optional. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

/** GFM table at lines[li]: a header row containing a pipe, a `---` delimiter
 * row of equal width (optional `:` alignment), then body rows while pipes
 * continue. Returns the block and the index after it, or null. */
function tryTable(lines: string[], li: number): { block: Block; next: number } | null {
  const head = lines[li] as string;
  const delim = lines[li + 1];
  if (delim === undefined || !head.includes("|")) return null;
  const headCells = splitRow(head);
  const delimCells = splitRow(delim);
  if (delimCells.length !== headCells.length || !delimCells.every((c) => DELIM_CELL.test(c.trim()))) {
    return null;
  }
  const align: TableAlign[] = delimCells.map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const cols = headCells.length;
  const rows: Inline[][][] = [];
  let next = li + 2;
  while (next < lines.length) {
    const raw = lines[next] as string;
    if (!raw.includes("|") || classify(raw).kind !== "text") break;
    const cells = splitRow(raw).map((c) => parseInline(c.trim()));
    cells.length = Math.min(cells.length, cols);
    while (cells.length < cols) cells.push([]);
    rows.push(cells);
    next++;
  }
  return {
    block: { type: "table", align, head: headCells.map((c) => parseInline(c.trim())), rows },
    next,
  };
}

function proseBlocks(s: string, blocks: Block[]): void {
  for (const para of s.split(/\n{2,}/)) {
    if (para.trim() === "") continue;
    let text: string[] = [];
    let list: Line[] | null = null;
    let quote: string[] | null = null;
    const flushText = (): void => {
      if (text.length > 0) {
        blocks.push({ type: "p", children: parseInline(text.join("\n").trim()) });
        text = [];
      }
    };
    const flushList = (): void => {
      if (list !== null) {
        const first = list[0] as Line;
        const items = list.map((l) => parseInline((l as { body: string }).body.trim()));
        blocks.push(
          first.kind === "ol"
            ? { type: "ol", start: (first as { n: number }).n, items }
            : { type: "ul", items },
        );
        list = null;
      }
    };
    const flushQuote = (): void => {
      if (quote !== null) {
        blocks.push({ type: "quote", children: parseInline(quote.join("\n").trim()) });
        quote = null;
      }
    };
    const flushAll = (): void => {
      flushText();
      flushList();
      flushQuote();
    };
    const lines = para.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = classify(lines[li] as string);
      switch (line.kind) {
        case "h":
          flushAll();
          blocks.push({ type: "h", level: line.level, children: parseInline(line.body.trim()) });
          break;
        case "hr":
          flushAll();
          blocks.push({ type: "hr" });
          break;
        case "ul":
        case "ol":
          flushText();
          flushQuote();
          if (list !== null && (list[0] as Line).kind !== line.kind) flushList();
          if (list === null) list = [];
          list.push(line);
          break;
        case "quote":
          flushText();
          flushList();
          if (quote === null) quote = [];
          quote.push(line.body);
          break;
        case "text": {
          const t = tryTable(lines, li);
          if (t !== null) {
            flushAll();
            blocks.push(t.block);
            li = t.next - 1;
            break;
          }
          flushList();
          flushQuote();
          text.push(line.body);
          break;
        }
      }
    }
    flushAll();
  }
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    proseBlocks(text.slice(last, m.index), blocks);
    blocks.push({ type: "pre", text: (m[1] as string).replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  proseBlocks(text.slice(last), blocks);
  return blocks;
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
        renderInlines(inline.children, a);
        parent.append(a);
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

export function renderMarkdown(text: string): HTMLElement {
  const root = document.createElement("div");
  for (const block of parseMarkdown(text)) {
    switch (block.type) {
      case "pre": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = block.text;
        pre.append(code);
        root.append(pre);
        break;
      }
      case "h": {
        const p = document.createElement("p");
        p.className = `md-h md-h${block.level}`;
        renderInlines(block.children, p);
        root.append(p);
        break;
      }
      case "ul":
      case "ol": {
        const list = document.createElement(block.type);
        if (block.type === "ol" && block.start !== 1) list.setAttribute("start", String(block.start));
        for (const item of block.items) {
          const li = document.createElement("li");
          renderInlines(item, li);
          list.append(li);
        }
        root.append(list);
        break;
      }
      case "quote": {
        const div = document.createElement("div");
        div.className = "md-quote";
        renderInlines(block.children, div);
        root.append(div);
        break;
      }
      case "table": {
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
        root.append(wrap);
        break;
      }
      case "hr":
        root.append(document.createElement("hr"));
        break;
      default: {
        const p = document.createElement("p");
        renderInlines(block.children, p);
        root.append(p);
      }
    }
  }
  return root;
}
