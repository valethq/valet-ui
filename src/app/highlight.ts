// A small, dependency-free syntax colourer for the file viewer. It knows
// comments, strings, numbers, keywords, calls and type-like names per
// language family; anything unknown is plain text. Pure: it returns tokens.

export type TokenKind = "c" | "s" | "n" | "k" | "f" | "t" | "";
export interface Token {
  kind: TokenKind;
  text: string;
}

export interface Lang {
  name: string;
  line?: string[];
  block?: [string, string][];
  /** Quote characters; those listed in `multiline` may span lines. */
  quotes?: string;
  multiline?: string;
  triple?: boolean;
  keywords?: Set<string>;
  /** Capitalised names are coloured as types. */
  types?: boolean;
  /** Keywords match in any case, as in SQL. */
  caseless?: boolean;
  /** Line comments need whitespace (or line start) before them, as in shell and YAML. */
  spacedComment?: boolean;
  /** `/…/` after an operator is a regular expression literal, as in JavaScript. */
  regex?: boolean;
}

const words = (s: string): Set<string> => new Set(s.split(" "));

const JS_KW = words(
  "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let namespace new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
);
const PY_KW = words(
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield match case",
);
const SH_KW = words(
  "if then else elif fi for while until do done case esac in function return local export readonly declare set unset shift exit echo cd source",
);
const GO_KW = words(
  "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
);
const RS_KW = words(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
);
const C_KW = words(
  "auto break case catch char class const continue default delete do double else enum extends extern false final float for fun func goto if implements import inline int interface let long namespace new nil null override package private protected public return self short signed sizeof static struct super switch template this throw throws true try typedef typename union unsigned using val var virtual void volatile when where while",
);
const RB_KW = words(
  "begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require",
);
const SQL_KW = words(
  "select from where and or not insert into values update set delete create table index view drop alter add primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end exists returning",
);
const CSS_KW = words("important media supports keyframes import from to and not only");

const C_LIKE = { line: ["//"], block: [["/*", "*/"]] as [string, string][], quotes: "\"'", types: true };

const LANGS: Record<string, Lang> = {
  ts: { name: "TypeScript", ...C_LIKE, quotes: "\"'`", multiline: "`", keywords: JS_KW, regex: true },
  js: { name: "JavaScript", ...C_LIKE, quotes: "\"'`", multiline: "`", keywords: JS_KW, regex: true },
  json: { name: "JSON", quotes: '"', keywords: words("true false null") },
  py: { name: "Python", line: ["#"], quotes: "\"'", triple: true, keywords: PY_KW, types: true },
  sh: { name: "Shell", line: ["#"], quotes: "\"'", multiline: "\"'", keywords: SH_KW, spacedComment: true },
  go: { name: "Go", ...C_LIKE, quotes: "\"'`", multiline: "`", keywords: GO_KW },
  rs: { name: "Rust", ...C_LIKE, quotes: '"', keywords: RS_KW },
  c: { name: "C-family", ...C_LIKE, keywords: C_KW },
  rb: { name: "Ruby", line: ["#"], quotes: "\"'", keywords: RB_KW, types: true },
  sql: { name: "SQL", line: ["--"], block: [["/*", "*/"]], quotes: "'\"", keywords: SQL_KW, caseless: true },
  css: { name: "CSS", block: [["/*", "*/"]], quotes: "\"'", keywords: CSS_KW },
  html: { name: "HTML", block: [["<!--", "-->"]], quotes: "\"'" },
  yaml: {
    name: "YAML",
    line: ["#"],
    quotes: "\"'",
    keywords: words("true false null yes no"),
    spacedComment: true,
  },
  toml: { name: "TOML", line: ["#"], quotes: "\"'", keywords: words("true false"), spacedComment: true },
  md: { name: "Markdown" },
};

const EXT: Record<string, keyof typeof LANGS> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "ts",
  json5: "ts",
  py: "py",
  pyi: "py",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  fish: "sh",
  env: "sh",
  go: "go",
  rs: "rs",
  c: "c",
  h: "c",
  cc: "c",
  cpp: "c",
  hpp: "c",
  cs: "c",
  java: "c",
  kt: "c",
  kts: "c",
  swift: "c",
  scala: "c",
  dart: "c",
  zig: "c",
  rb: "rb",
  sql: "sql",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "toml",
  conf: "toml",
  md: "md",
  markdown: "md",
  mdx: "md",
};

const NAMES: Record<string, keyof typeof LANGS> = {
  dockerfile: "sh",
  makefile: "sh",
  ".bashrc": "sh",
  ".zshrc": "sh",
  ".gitignore": "sh",
  ".env": "sh",
};

/** The language for a file name, or null for plain text. */
export function langFor(path: string): Lang | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const key = NAMES[name] ?? EXT[name.includes(".") ? (name.split(".").pop() ?? "") : ""];
  return key === undefined ? null : (LANGS[key] ?? null);
}

const NUMBER = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_$][\w$]*/y;
const CALL = /\s*\(/y;
const WORD = /[\w$]/;

function sticky(re: RegExp, s: string, i: number): string | null {
  re.lastIndex = i;
  return re.exec(s)?.[0] ?? null;
}

/** End of the string opened by `q` at `i` (exclusive), honouring backslash escapes. */
function stringEnd(s: string, i: number, q: string, multi: boolean): number {
  let k = i + q.length;
  while (k < s.length) {
    const ch = s[k];
    if (ch === "\\") k += 2;
    else if (s.startsWith(q, k)) return k + q.length;
    else if (ch === "\n" && !multi) return k;
    else k++;
  }
  return s.length;
}

/** A `/` starts a regex when the code before it ends in an operator, a bracket, a keyword or nothing. */
function regexAllowed(out: Token[], plain: string): boolean {
  const pending = plain.trimEnd();
  if (pending !== "") return /[(,=:[!&|?{};+\-*%<>~^]$/.test(pending);
  for (let k = out.length - 1; k >= 0; k--) {
    const tok = out[k] as Token;
    if (tok.kind === "c") continue;
    if (tok.kind === "k") return !["this", "super", "true", "false", "null", "undefined"].includes(tok.text);
    if (tok.kind !== "") return false;
    const t = tok.text.trimEnd();
    if (t === "") continue;
    return /[(,=:[!&|?{};+\-*%<>~^]$/.test(t);
  }
  return true;
}

/** End of a regex literal starting at `i` (flags included), or -1 when the line ends first. */
function regexEnd(s: string, i: number): number {
  let k = i + 1;
  let inClass = false;
  if (s[k] === "/" || s[k] === "*") return -1;
  while (k < s.length && s[k] !== "\n") {
    const ch = s[k];
    if (ch === "\\") k++;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      k++;
      while (k < s.length && /[a-z]/.test(s[k] as string)) k++;
      return k;
    }
    k++;
  }
  return -1;
}

/** Tokens for the whole text; comments and strings may span lines. */
export function tokenize(text: string, lang: Lang): Token[] {
  const out: Token[] = [];
  let plain = "";
  const push = (kind: TokenKind, t: string): void => {
    if (plain !== "") {
      out.push({ kind: "", text: plain });
      plain = "";
    }
    out.push({ kind, text: t });
  };
  let i = 0;
  scan: while (i < text.length) {
    const ch = text[i] as string;
    for (const [open, close] of lang.block ?? []) {
      if (text.startsWith(open, i)) {
        const e = text.indexOf(close, i + open.length);
        const end = e < 0 ? text.length : e + close.length;
        push("c", text.slice(i, end));
        i = end;
        continue scan;
      }
    }
    for (const lc of lang.line ?? []) {
      if (text.startsWith(lc, i) && (!lang.spacedComment || i === 0 || /\s/.test(text[i - 1] as string))) {
        const e = text.indexOf("\n", i);
        const end = e < 0 ? text.length : e;
        push("c", text.slice(i, end));
        i = end;
        continue scan;
      }
    }
    if (lang.quotes?.includes(ch)) {
      const q = lang.triple === true && text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      const end = stringEnd(text, i, q, q.length === 3 || (lang.multiline?.includes(ch) ?? false));
      push("s", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "/" && lang.regex === true && regexAllowed(out, plain)) {
      const end = regexEnd(text, i);
      if (end > 0) {
        push("s", text.slice(i, end));
        i = end;
        continue;
      }
    }
    const prevWord = i > 0 && WORD.test(text[i - 1] as string);
    if (!prevWord && ch >= "0" && ch <= "9") {
      const n = sticky(NUMBER, text, i);
      if (n !== null) {
        push("n", n);
        i += n.length;
        continue;
      }
    }
    if (!prevWord && /[A-Za-z_$]/.test(ch)) {
      const id = sticky(IDENT, text, i) as string;
      if (lang.keywords?.has(lang.caseless === true ? id.toLowerCase() : id)) push("k", id);
      else if (lang.keywords !== undefined && sticky(CALL, text, i + id.length) !== null) push("f", id);
      else if (lang.types === true && /^[A-Z][a-z0-9]/.test(id)) push("t", id);
      else plain += id;
      i += id.length;
      continue;
    }
    plain += ch;
    i++;
  }
  if (plain !== "") out.push({ kind: "", text: plain });
  return out;
}

/** Tokens split into lines (a token spanning lines is cut at each newline). */
export function highlightLines(text: string, lang: Lang | null): Token[][] {
  const lines: Token[][] = [[]];
  const tokens = lang === null ? [{ kind: "" as const, text }] : tokenize(text, lang);
  for (const tok of tokens) {
    const parts = tok.text.split("\n");
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part !== "") (lines[lines.length - 1] as Token[]).push({ kind: tok.kind, text: part });
    });
  }
  if (text.endsWith("\n") && lines.length > 1) lines.pop();
  return lines;
}
