// Link destinations that point at files: `src/x.ts`, `src/x.ts:12`, `src/x.ts#L10-L20`,
// `/abs/path`, `file:///abs/path`. Pure, shared by the markdown parser and the viewer.

export interface FileRef {
  path: string;
  line?: number;
  end?: number;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DRIVE = /^[A-Za-z]:[\\/]/;
/** `a.ts:12` looks like a scheme but is a bare file name with a line. */
const NAME_LINE = /^[^:/]+:\d+(?:[-:]\d+)?$/;
const HASH_LINES = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/;
const COLON_LINES = /:(\d+)(?:(?:-(\d+))|(?::\d+))?$/;

function decode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

function withLines(path: string, a: string | undefined, b: string | undefined): FileRef {
  const line = Number(a);
  const end = Number(b);
  if (!(line > 0)) return { path };
  return end > line ? { path, line, end } : { path, line };
}

/** The file a link destination names, or null when it is a web/other-scheme link or a bare fragment. */
export function fileRef(href: string): FileRef | null {
  let s = href.trim();
  if (/^file:\/\//i.test(s)) s = s.slice(7).replace(/^localhost(?=\/)/i, "");
  else if (s === "" || s.startsWith("#") || s.startsWith("?") || s.startsWith("//")) return null;
  else if (SCHEME.test(s) && !DRIVE.test(s) && !NAME_LINE.test(s)) return null;
  const hash = s.indexOf("#");
  let frag = "";
  if (hash >= 0) {
    frag = s.slice(hash + 1);
    s = s.slice(0, hash);
  }
  s = decode(s);
  if (s === "") return null;
  const h = HASH_LINES.exec(frag);
  if (h !== null) return withLines(s, h[1], h[2]);
  const c = COLON_LINES.exec(s);
  if (c !== null && c.index > 0) return withLines(s.slice(0, c.index), c[1], c[2]);
  return { path: s };
}

const LABEL_LINES = /:(\d+)(?:-(\d+))?$/;

/** A link whose destination has no lines takes them from a `:12` or `:12-20` ending its text. */
export function withLabelLines(ref: FileRef, label: string): FileRef {
  if (ref.line !== undefined) return ref;
  const m = LABEL_LINES.exec(label.trim().replace(/^`+|`+$/g, ""));
  return m === null ? ref : withLines(ref.path, m[1], m[2]);
}

export const baseName = (path: string): string =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

export const isAbsolutePath = (path: string): boolean => path.startsWith("/") || DRIVE.test(path);

/** `path` resolved against the directory `dir` (both slash-separated); `..` past the top is kept. */
export function joinPath(dir: string, path: string): string {
  if (isAbsolutePath(path) || dir === "") return path;
  const out: string[] = [];
  for (const seg of `${dir}/${path}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

export const lineLabel = (ref: FileRef): string =>
  ref.line === undefined ? "" : ref.end === undefined ? `:${ref.line}` : `:${ref.line}-${ref.end}`;
