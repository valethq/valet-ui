// Block markdown: a line-based parser with real nesting (lists and quotes hold
// blocks), fences, indented code, setext/ATX headings, GFM tables, task lists,
// link reference definitions and footnotes. Pure and unit-tested.

import { type Inline, type MdContext, newContext, normLabel, parseInline } from "./md-inline";

export type TableAlign = "left" | "center" | "right" | null;

export interface ListItem {
  checked: boolean | null;
  children: Block[];
}

export type Block =
  | { type: "p"; children: Inline[] }
  | { type: "pre"; text: string }
  | { type: "h"; level: number; children: Inline[] }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; start: number; items: ListItem[] }
  | { type: "quote"; children: Block[] }
  | { type: "table"; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] }
  | { type: "footnotes"; items: Block[][] }
  | { type: "hr" };

const MAX_DEPTH = 12;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const REF_DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^<>]*>|\S+)(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const DELIM_CELL = /^:?-{1,}:?$/;

interface Fence {
  ch: string;
  len: number;
  indent: number;
}

function fenceOpen(line: string): Fence | null {
  const m = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  if (m === null) return null;
  const ch = (m[2] as string)[0] as string;
  if (ch === "`" && (m[3] as string).includes("`")) return null;
  return { ch, len: (m[2] as string).length, indent: (m[1] as string).length };
}

function fenceCloses(line: string, f: Fence): boolean {
  const t = line.trim();
  return /^ {0,3}\S/.test(line) && t.length >= f.len && [...t].every((x) => x === f.ch);
}

const indentOf = (l: string): number => l.length - l.trimStart().length;
const stripIndent = (l: string, n: number): string => l.slice(Math.min(indentOf(l), n));

interface Marker {
  indent: number;
  ordered: boolean;
  num: number;
  offset: number;
  rest: string;
}

function parseMarker(line: string): Marker | null {
  const m = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))(?:( +)|$)/.exec(line);
  if (m === null || HR.test(line)) return null;
  const indent = (m[1] as string).length;
  const len = m[2] !== undefined ? 1 : (m[3] as string).length + 1;
  const spaces = m[5]?.length ?? 0;
  const gap = spaces >= 1 && spaces <= 4 ? spaces : 1;
  const offset = indent + len + gap;
  return {
    indent,
    ordered: m[2] === undefined,
    num: m[3] === undefined ? 0 : Number(m[3]),
    offset,
    rest: line.slice(offset),
  };
}

function startsBlock(l: string): boolean {
  return ATX.test(l) || HR.test(l) || fenceOpen(l) !== null || /^ {0,3}>/.test(l) || parseMarker(l) !== null;
}

/** Heading text after the opening hashes, minus an optional closing run of hashes. */
function atxBody(line: string, opening: string): string {
  const body = line.slice(opening.length).trimEnd();
  let e = body.length;
  while (e > 0 && body[e - 1] === "#") e--;
  if (e < body.length && (e === 0 || body[e - 1] === " " || body[e - 1] === "\t"))
    return body.slice(0, e).trimEnd();
  return body;
}

/** Whether a line belongs to the list item opened by marker `m`. */
function continues(l: string, m: Marker, afterBlank: boolean): boolean {
  const ind = indentOf(l);
  if (ind >= m.offset) return true;
  if (ind < m.indent + 2) return false;
  return parseMarker(l) !== null || (!afterBlank && !startsBlock(l));
}

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

/** GFM table at lines[li]: a header row containing a pipe, a `---` delimiter row of equal width
 * (optional `:` alignment), then body rows while pipes continue. */
function tryTable(lines: string[], li: number, ctx: MdContext): { block: Block; next: number } | null {
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
    if (!raw.includes("|") || startsBlock(raw)) break;
    const cells = splitRow(raw).map((c) => parseInline(c.trim(), ctx));
    cells.length = Math.min(cells.length, cols);
    while (cells.length < cols) cells.push([]);
    rows.push(cells);
    next++;
  }
  return {
    block: { type: "table", align, head: headCells.map((c) => parseInline(c.trim(), ctx)), rows },
    next,
  };
}

function makeItem(lines: string[], ctx: MdContext, depth: number): ListItem {
  let checked: boolean | null = null;
  const t = TASK.exec(lines[0] as string);
  if (t !== null) {
    checked = t[1] !== " ";
    lines[0] = (lines[0] as string).slice(t[0].length);
  }
  return { checked, children: parseBlocks(lines, ctx, depth + 1) };
}

function parseList(
  lines: string[],
  start: number,
  ctx: MdContext,
  depth: number,
): { block: Block; next: number } {
  const first = parseMarker(lines[start] as string) as Marker;
  const items: ListItem[] = [];
  let i = start;
  for (;;) {
    const m = parseMarker(lines[i] as string) as Marker;
    const body: string[] = [m.rest];
    i++;
    while (i < lines.length) {
      const l = lines[i] as string;
      if (l.trim() === "") {
        let k = i;
        while (k < lines.length && (lines[k] as string).trim() === "") k++;
        if (k >= lines.length || !continues(lines[k] as string, m, true)) break;
        for (; i < k; i++) body.push("");
        continue;
      }
      if (!continues(l, m, false)) break;
      body.push(stripIndent(l, m.offset));
      i++;
    }
    items.push(makeItem(body, ctx, depth));
    let k = i;
    while (k < lines.length && (lines[k] as string).trim() === "") k++;
    const sibling = k < lines.length ? parseMarker(lines[k] as string) : null;
    if (sibling === null || sibling.ordered !== first.ordered) break;
    i = k;
  }
  return { block: first.ordered ? { type: "ol", start: first.num, items } : { type: "ul", items }, next: i };
}

function parseBlocks(lines: string[], ctx: MdContext, depth: number): Block[] {
  const blocks: Block[] = [];
  if (depth > MAX_DEPTH) {
    const text = lines.join("\n").trim();
    if (text !== "") blocks.push({ type: "p", children: parseInline(text, ctx) });
    return blocks;
  }
  let para: string[] = [];
  const paraText = (): string => para.join("\n").trimEnd();
  const flush = (): void => {
    if (para.length > 0) blocks.push({ type: "p", children: parseInline(paraText(), ctx) });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }

    const fence = fenceOpen(line);
    if (fence !== null) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !fenceCloses(lines[i] as string, fence)) {
        body.push(stripIndent(lines[i] as string, fence.indent));
        i++;
      }
      i++;
      blocks.push({ type: "pre", text: body.join("\n") });
      continue;
    }

    if (para.length === 0 && /^ {4}/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i] as string) || (lines[i] as string).trim() === "")) {
        body.push((lines[i] as string).slice(4));
        i++;
      }
      while (body.length > 0 && (body[body.length - 1] as string).trim() === "") body.pop();
      blocks.push({ type: "pre", text: body.join("\n") });
      continue;
    }

    if (para.length > 0 && SETEXT_H1.test(line)) {
      blocks.push({ type: "h", level: 1, children: parseInline(paraText(), ctx) });
      para = [];
      i++;
      continue;
    }

    const h = ATX.exec(line);
    if (h !== null) {
      flush();
      blocks.push({
        type: "h",
        level: (h[1] as string).length,
        children: parseInline(atxBody(line, h[0]), ctx),
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      for (let m = QUOTE.exec(lines[i] ?? ""); m !== null; m = QUOTE.exec(lines[i] ?? "")) {
        inner.push(m[1] as string);
        i++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, ctx, depth + 1) });
      continue;
    }

    const marker = parseMarker(line);
    if (
      marker !== null &&
      (para.length === 0 || (marker.rest.trim() !== "" && (!marker.ordered || marker.num === 1)))
    ) {
      flush();
      const list = parseList(lines, i, ctx, depth);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const table = tryTable(lines, i, ctx);
    if (table !== null) {
      flush();
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    para.push(line.replace(/^ +/, ""));
    i++;
  }
  flush();
  return blocks;
}

/** Expands leading tabs outside fences and pulls out link reference and footnote definitions. */
function prepare(text: string, ctx: MdContext): string[] {
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: Fence | null = null;
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] as string;
    if (fence !== null) {
      out.push(raw);
      if (fenceCloses(raw, fence)) fence = null;
      continue;
    }
    const l = raw.replace(/^[ \t]+/, (w) => w.replace(/\t/g, "    "));
    fence = fenceOpen(l);
    if (fence !== null) {
      out.push(l);
      continue;
    }
    const fn = FOOTNOTE_DEF.exec(l);
    if (fn !== null) {
      const body = [fn[2] as string];
      for (; i + 1 < src.length; i++) {
        let k = i + 1;
        while (k < src.length && (src[k] as string).trim() === "") k++;
        if (k >= src.length || !/^ {2,}\S/.test(src[k] as string)) break;
        for (; i + 1 < k; i++) body.push("");
        body.push((src[k] as string).replace(/^ {1,4}/, ""));
        i = k - 1;
      }
      ctx.fnDefs.set(normLabel(fn[1] as string), body);
      continue;
    }
    const ref = REF_DEF.exec(l);
    if (ref !== null) {
      const key = normLabel(ref[1] as string);
      const dest = (ref[2] as string).replace(/^<|>$/g, "");
      const title = ref[3]?.slice(1, -1);
      if (!ctx.refs.has(key)) ctx.refs.set(key, { href: dest, ...(title ? { title } : {}) });
      continue;
    }
    out.push(l);
  }
  return out;
}

export interface MarkdownOptions {
  emojiShortcodes?: boolean;
}

export function parseMarkdown(text: string, options: MarkdownOptions = {}): Block[] {
  const ctx = newContext(options.emojiShortcodes === true);
  const blocks = parseBlocks(prepare(text, ctx), ctx, 0);
  const notes: Block[][] = [];
  for (let k = 0; k < ctx.fnOrder.length; k++) {
    notes.push(parseBlocks(ctx.fnDefs.get(ctx.fnOrder[k] as string) ?? [], ctx, 1));
  }
  if (notes.length > 0) blocks.push({ type: "footnotes", items: notes });
  return blocks;
}
