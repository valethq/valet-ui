/** Parts too long to send whole are sent in pieces. Only what a reader would otherwise wait on is cut: a model's
 * text, its reasoning, and a tool's output. Everything else is small and always travels whole. */

interface Cuttable {
  type: string;
  data: object;
}

export interface WirePart extends Cuttable {
  id: string;
  status?: string;
  /** Set on a part sent short: the length of its full text or output. */
  partial?: number;
}

export interface WireEntry {
  message: { id: string; seq: number; status: string };
  parts: WirePart[];
}

export interface Piece {
  id: string;
  /** Where in the full content this piece starts. */
  at: number;
  text: string;
}

export function contentOf(p: Cuttable): string | null {
  const d = p.data as Record<string, unknown>;
  const value =
    p.type === "text" || p.type === "reasoning" ? d.text : p.type === "tool-call" ? d.output : undefined;
  return typeof value === "string" ? value : null;
}

export const withContent = <P extends Cuttable>(p: P, content: string): P => ({
  ...p,
  data: { ...p.data, [p.type === "tool-call" ? "output" : "text"]: content },
});

interface Slice {
  id: string;
  text: string;
}

/** Parts that may be cut, as two groups sent in this order: what the model said, then tool output. Newest
 * message first inside each group. Messages and parts still streaming are left out; their live events carry them. */
function groupsOf(entries: WireEntry[]): Slice[][] {
  const said: Slice[] = [];
  const tools: Slice[] = [];
  for (const e of [...entries].sort((a, b) => b.message.seq - a.message.seq)) {
    if (e.message.status === "streaming") continue;
    for (const p of e.parts) {
      const text = p.status === "streaming" ? null : contentOf(p);
      if (text !== null) (p.type === "tool-call" ? tools : said).push({ id: p.id, text });
    }
  }
  return [said, tools];
}

/** Cuts `len` characters from `from`, backing off one if that would split a surrogate pair. */
export function cut(text: string, from: number, len: number): string {
  let end = Math.min(text.length, from + len);
  if (end < text.length) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end = end - 1 > from ? end - 1 : end + 1;
  }
  return text.slice(from, end);
}

/** One piece (at most `partChars`) for each part in the group that still has content to send. */
function pass(
  group: Slice[],
  have: Map<string, number>,
  partChars: number,
  left: number,
  out: Piece[],
): number {
  for (const s of group) {
    if (left <= 0) break;
    const at = have.get(s.id) ?? 0;
    if (at >= s.text.length) continue;
    const text = cut(s.text, at, Math.min(partChars, left));
    have.set(s.id, at + text.length);
    left -= text.length;
    out.push({ id: s.id, at, text });
  }
  return left;
}

/** A page's first round gives each part one piece, so everything shows something at once. Later rounds keep
 * going over the same parts, in the same order, until their budget is spent: a lone huge part is not held to
 * one piece per round trip. */
function nextRound(
  groups: Slice[][],
  have: Map<string, number>,
  partChars: number,
  budget: number,
  first: boolean,
): Piece[] {
  const out: Piece[] = [];
  let left = budget;
  for (const group of groups) {
    for (let before = -1; left > 0 && left !== before; ) {
      before = left;
      left = pass(group, have, partChars, left, out);
      if (first) break;
    }
  }
  return out;
}

/** The pieces of round `round` (0 is the page itself) and whether nothing is left to send after it. */
export function roundPieces(
  entries: WireEntry[],
  partChars: number,
  budget: number,
  round: number,
): { pieces: Piece[]; done: boolean } {
  const groups = groupsOf(entries);
  const have = new Map<string, number>();
  let pieces: Piece[] = [];
  for (let r = 0; r <= round; r++) {
    pieces = nextRound(groups, have, partChars, budget, r === 0);
    if (pieces.length === 0) break;
  }
  const done = groups.every((g) => g.every((s) => (have.get(s.id) ?? 0) >= s.text.length));
  return { pieces, done };
}

/** Round 0 as the page body: every cuttable part carries its first piece, and a short one says how long it really is. */
export function firstRound(entries: WireEntry[], partChars: number, budget: number): WireEntry[] {
  const groups = groupsOf(entries);
  const first = new Map(nextRound(groups, new Map(), partChars, budget, true).map((p) => [p.id, p.text]));
  const total = new Map(groups.flat().map((s) => [s.id, s.text.length]));
  return entries.map((e) => ({
    ...e,
    parts: e.parts.map((p) => {
      const length = total.get(p.id);
      if (length === undefined) return p;
      const piece = first.get(p.id) ?? "";
      return piece.length === length ? p : { ...withContent(p, piece), partial: length };
    }),
  }));
}
