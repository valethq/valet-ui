// Inline markdown: code spans, links (inline, reference, angle and bare),
// images (rendered as links, never loaded), footnote refs, escapes, entities
// and CommonMark-style emphasis. Pure: it returns a tree and builds no markup.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "link"; href: string; title?: string; children: Inline[] }
  | { type: "footnote"; n: number };

export interface LinkDef {
  href: string;
  title?: string;
}

/** Document-wide state shared by every inline parse: link definitions and footnotes. */
export interface MdContext {
  refs: Map<string, LinkDef>;
  fnDefs: Map<string, string[]>;
  fnOrder: string[];
}

export const newContext = (): MdContext => ({ refs: new Map(), fnDefs: new Map(), fnOrder: [] });
export const normLabel = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

interface Delim {
  type: "delim";
  ch: string;
  n: number;
  orig: number;
  open: boolean;
  close: boolean;
}
type Item = Inline | Delim;

const MAX_DEST = 4096;
const MAX_TITLE = 1000;
const MAX_PAREN_DEPTH = 32;
const MAX_DEPTH = 6;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

const URL_RE = /https?:\/\/[^\s<>"']+/iy;
const WWW_RE = /www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?(?:[/?#][^\s<>"']*)?/iy;
const EMAIL_RE = /[A-Za-z0-9._+-]+@[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/y;
const ANGLE_URL = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const ANGLE_MAIL =
  /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)>/y;
const ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/y;
const FOOTNOTE_RE = /\[\^([^\]\s]{1,100})\]/y;
const REF_TAIL_RE = /\[([^\]]*)\]/y;

const ENTITIES = new Map(
  Object.entries({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    copy: "©",
    reg: "®",
    trade: "™",
    hellip: "…",
    mdash: "—",
    ndash: "–",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    bull: "•",
    middot: "·",
    times: "×",
    divide: "÷",
    deg: "°",
    plusmn: "±",
    laquo: "«",
    raquo: "»",
    larr: "←",
    rarr: "→",
    uarr: "↑",
    darr: "↓",
    harr: "↔",
    hearts: "♥",
    euro: "€",
    pound: "£",
    yen: "¥",
    cent: "¢",
    sect: "§",
    para: "¶",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    le: "≤",
    ge: "≥",
    ne: "≠",
    infin: "∞",
    micro: "µ",
  }),
);

function trimSpaces(s: string): string {
  let e = s.length;
  while (e > 0 && s[e - 1] === " ") e--;
  return e === s.length ? s : s.slice(0, e);
}

function sticky(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

function decodeEntity(m: RegExpExecArray): string | null {
  if (m[3] !== undefined) return ENTITIES.get(m[3]) ?? null;
  const cp = m[1] !== undefined ? Number.parseInt(m[1], 10) : Number.parseInt(m[2] as string, 16);
  const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
  return ok ? String.fromCodePoint(cp) : "�";
}

const unescapeMd = (s: string): string => s.replace(/\\([!-/:-@[-`{-~])/g, "$1");

/** Start of the next backtick run of exactly n, at or after `from`; -1 if none. */
function findRun(s: string, from: number, n: number): number {
  let k = from;
  while (k < s.length) {
    const p = s.indexOf("`", k);
    if (p < 0) return -1;
    let q = p;
    while (s[q] === "`") q++;
    if (q - p === n) return p;
    k = q;
  }
  return -1;
}

/** Every `[` mapped to its matching `]` in one pass, skipping escapes and code spans. */
function pairBrackets(s: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "`") {
      let j = i;
      while (s[j] === "`") j++;
      const close = findRun(s, j, j - i);
      i = close >= 0 ? close + (j - i) - 1 : j - 1;
    } else if (c === "[") stack.push(i);
    else if (c === "]") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, i);
    }
  }
  return pairs;
}

interface Tail {
  end: number;
  href: string;
  title?: string;
}

/** `(dest "title")` starting at the `(` at s[i]: angle or balanced-paren destination, optional title. */
function inlineTail(s: string, i: number): Tail | null {
  let p = i + 1;
  const skip = (): void => {
    while (p < s.length && SPACE.test(s[p] as string)) p++;
  };
  skip();
  let href: string;
  if (s[p] === "<") {
    const m = sticky(/<([^<>\n]*)>/y, s, p);
    if (m === null) return null;
    href = m[1] as string;
    p += m[0].length;
  } else {
    const start = p;
    let depth = 0;
    while (p < s.length && p - start <= MAX_DEST) {
      const ch = s[p] as string;
      if (ch === "\\" && p + 1 < s.length) {
        p += 2;
        continue;
      }
      if (ch === "(") {
        if (++depth > MAX_PAREN_DEPTH) return null;
      } else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      } else if (SPACE.test(ch)) break;
      p++;
    }
    if (depth !== 0 || p - start > MAX_DEST) return null;
    href = s.slice(start, p);
  }
  skip();
  let title: string | undefined;
  const q = s[p];
  if (q === '"' || q === "'" || q === "(") {
    const end = q === "(" ? ")" : q;
    let buf = "";
    let k = p + 1;
    while (k < s.length && s[k] !== end && k - p <= MAX_TITLE) {
      if (s[k] === "\\" && k + 1 < s.length) k++;
      buf += s[k];
      k++;
    }
    if (k >= s.length || s[k] !== end) return null;
    title = buf;
    p = k + 1;
    skip();
  }
  if (s[p] !== ")") return null;
  return { end: p + 1, href: unescapeMd(href), ...(title ? { title } : {}) };
}

/** A link or image starting at the `[` at s[open]: inline, full/collapsed reference, or shortcut. */
function matchLink(
  s: string,
  open: number,
  close: number | undefined,
  ctx: MdContext,
): (Tail & { close: number }) | null {
  if (close === undefined) return null;
  const next = s[close + 1];
  if (next === "(") {
    const t = inlineTail(s, close + 1);
    return t === null ? null : { ...t, close };
  }
  const label = s.slice(open + 1, close);
  let key = label;
  let end = close + 1;
  if (next === "[") {
    const m = sticky(REF_TAIL_RE, s, close + 1);
    if (m !== null) {
      key = m[1] === "" ? label : (m[1] as string);
      end = close + 1 + m[0].length;
    }
  }
  const def = ctx.refs.get(normLabel(key));
  return def === undefined ? null : { end, close, ...def };
}

function trimUrl(u: string): string {
  const count = (ch: string): number => u.split(ch).length - 1;
  const opens: Record<string, number> = { "(": count("("), "[": count("["), "{": count("{") };
  const closes: Record<string, number> = { ")": count(")"), "]": count("]"), "}": count("}") };
  const pairOf: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let end = u.length;
  while (end > 0) {
    const last = u[end - 1] as string;
    const pair = pairOf[last];
    if (/[?!.,:;*_~'"]/.test(last)) end--;
    else if (pair !== undefined && (closes[last] as number) > (opens[pair] as number)) {
      (closes[last] as number)--;
      end--;
    } else break;
  }
  return u.slice(0, end);
}

function runFlags(s: string, start: number, end: number, ch: string): { open: boolean; close: boolean } {
  const before = start === 0 ? " " : (s[start - 1] as string);
  const after = end >= s.length ? " " : (s[end] as string);
  const wsB = SPACE.test(before);
  const wsA = SPACE.test(after);
  const pB = PUNCT.test(before);
  const pA = PUNCT.test(after);
  const left = !wsA && (!pA || wsB || pB);
  const right = !wsB && (!pB || wsA || pA);
  if (ch === "_") return { open: left && (!right || pB), close: right && (!left || pA) };
  return { open: left, close: right };
}

/** Unmatched delimiters become text; adjacent text nodes merge. */
function finish(items: Item[]): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    const node: Inline = item.type === "delim" ? { type: "text", text: item.ch.repeat(item.n) } : item;
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text") last.text += node.text;
    else out.push(node);
  }
  return out;
}

/** CommonMark's process-emphasis (plus GFM `~`/`~~`) over a stack, with `openers_bottom` so it stays linear. */
function resolveEmphasis(items: Item[]): Inline[] {
  const out: Item[] = [];
  const bottoms = new Map<string, number>();
  for (const item of items) {
    if (item.type !== "delim" || !item.close) {
      out.push(item);
      continue;
    }
    const closer = item;
    const key = closer.ch === "~" ? `~${closer.n}` : `${closer.ch}${closer.open ? 1 : 0}${closer.orig % 3}`;
    while (closer.n > 0) {
      const floor = bottoms.get(key) ?? 0;
      let o = out.length - 1;
      for (; o >= floor; o--) {
        const cand = out[o] as Item;
        if (cand.type !== "delim" || cand.ch !== closer.ch || !cand.open) continue;
        if (closer.ch === "~") {
          if (cand.n === closer.n) break;
          continue;
        }
        const both = (cand.open && cand.close) || (closer.open && closer.close);
        if (both && (cand.orig + closer.orig) % 3 === 0 && !(cand.orig % 3 === 0 && closer.orig % 3 === 0)) {
          continue;
        }
        break;
      }
      if (o < floor) {
        bottoms.set(key, out.length);
        break;
      }
      const opener = out[o] as Delim;
      const use = closer.ch === "~" ? closer.n : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      const children = finish(out.splice(o + 1));
      opener.n -= use;
      closer.n -= use;
      if (opener.n === 0) out.pop();
      out.push({ type: closer.ch === "~" ? "del" : use === 2 ? "strong" : "em", children });
      for (const [k, b] of bottoms) if (b > o) bottoms.set(k, o);
    }
    if (closer.n > 0) out.push(closer);
  }
  return finish(out);
}

const linkNode = (href: string, title: string | undefined, children: Inline[]): Inline => ({
  type: "link",
  href,
  ...(title ? { title } : {}),
  children,
});

/** `noLinks` is set inside link text so links never nest. */
export function parseInline(s: string, ctx: MdContext, noLinks = false, depth = 0): Inline[] {
  if (depth > MAX_DEPTH) return s === "" ? [] : [{ type: "text", text: s }];
  const items: Item[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length > 0) {
      items.push({ type: "text", text: buf.join("") });
      buf = [];
    }
  };
  const dropTrailingSpaces = (): void => {
    for (let last = buf[buf.length - 1]; last !== undefined; last = buf[buf.length - 1]) {
      const trimmed = trimSpaces(last);
      if (trimmed === "") buf.pop();
      else {
        buf[buf.length - 1] = trimmed;
        return;
      }
    }
  };
  const push = (...nodes: Inline[]): void => {
    flush();
    items.push(...nodes);
  };
  const hasAt = s.includes("@");
  let pairs: Map<number, number> | null = null;
  const bracketPairs = (): Map<number, number> => {
    if (pairs === null) pairs = pairBrackets(s);
    return pairs;
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;

    if (c === "\\") {
      const n = s[i + 1];
      if (n === "\n") {
        dropTrailingSpaces();
        buf.push("\n");
        i += 2;
        while (s[i] === " ") i++;
      } else if (n !== undefined && ESCAPABLE.test(n)) {
        buf.push(n);
        i += 2;
      } else {
        buf.push(c);
        i++;
      }
      continue;
    }

    if (c === "\n") {
      dropTrailingSpaces();
      buf.push("\n");
      i++;
      while (s[i] === " ") i++;
      continue;
    }

    if (c === "&") {
      const m = sticky(ENTITY_RE, s, i);
      const decoded = m === null ? null : decodeEntity(m);
      if (m !== null && decoded !== null) {
        buf.push(decoded);
        i += m[0].length;
        continue;
      }
    }

    if (c === "`") {
      let j = i;
      while (s[j] === "`") j++;
      const n = j - i;
      const close = findRun(s, j, n);
      if (close < 0) {
        buf.push(s.slice(i, j));
        i = j;
        continue;
      }
      let code = s.slice(j, close).replace(/\n/g, " ");
      if (code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
      push({ type: "code", text: code });
      i = close + n;
      continue;
    }

    if (c === "[" && s[i + 1] === "^" && !noLinks) {
      const m = sticky(FOOTNOTE_RE, s, i);
      const id = m === null ? "" : normLabel(m[1] as string);
      if (m !== null && ctx.fnDefs.has(id)) {
        let n = ctx.fnOrder.indexOf(id);
        if (n < 0) n = ctx.fnOrder.push(id) - 1;
        push({ type: "footnote", n: n + 1 });
        i += m[0].length;
        continue;
      }
    }

    if ((c === "[" && !noLinks) || (c === "!" && s[i + 1] === "[")) {
      const image = c === "!";
      const open = image ? i + 1 : i;
      const link = matchLink(s, open, bracketPairs().get(open), ctx);
      if (link !== null) {
        if (SAFE_HREF.test(link.href.trim())) {
          const kids = parseInline(s.slice(open + 1, link.close), ctx, true, depth + 1);
          if (image) {
            const alt: Inline[] = kids.length > 0 ? kids : [{ type: "text", text: "image" }];
            if (noLinks) push(...alt);
            else push(linkNode(link.href.trim(), link.title, alt));
          } else {
            push(linkNode(link.href.trim(), link.title, kids));
          }
        } else {
          buf.push(s.slice(i, link.end));
        }
        i = link.end;
        continue;
      }
    }

    if (c === "<" && !noLinks) {
      const m = sticky(ANGLE_URL, s, i);
      const mail = m === null ? sticky(ANGLE_MAIL, s, i) : null;
      if (m !== null) {
        const href = m[1] as string;
        if (SAFE_HREF.test(href)) push(linkNode(href, undefined, [{ type: "text", text: href }]));
        else buf.push(m[0]);
        i += m[0].length;
        continue;
      }
      if (mail !== null) {
        const addr = mail[1] as string;
        push(linkNode(`mailto:${addr}`, undefined, [{ type: "text", text: addr }]));
        i += mail[0].length;
        continue;
      }
    }

    if (!noLinks && !isWord(s[i - 1])) {
      let url: string | null = null;
      let href = "";
      if (c === "h" || c === "H") {
        const m = sticky(URL_RE, s, i);
        if (m !== null) href = url = trimUrl(m[0]);
      } else if (c === "w" || c === "W") {
        const m = sticky(WWW_RE, s, i);
        if (m !== null) {
          url = trimUrl(m[0]);
          href = `https://${url}`;
        }
      }
      if (url === null && hasAt && /[A-Za-z0-9]/.test(c) && !/[._+-]/.test(s[i - 1] ?? " ")) {
        const m = sticky(EMAIL_RE, s, i);
        if (m !== null) {
          url = m[0];
          href = `mailto:${url}`;
        }
      }
      if (url !== null && url !== "") {
        push(linkNode(href, undefined, [{ type: "text", text: url }]));
        i += url.length;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      let j = i;
      while (s[j] === c) j++;
      const n = j - i;
      const flags = runFlags(s, i, j, c);
      if ((c === "~" && n > 2) || (!flags.open && !flags.close)) {
        buf.push(s.slice(i, j));
      } else {
        flush();
        items.push({ type: "delim", ch: c, n, orig: n, ...flags });
      }
      i = j;
      continue;
    }

    buf.push(c);
    i++;
  }
  flush();
  return resolveEmphasis(items);
}
