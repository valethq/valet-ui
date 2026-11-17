import { describe, expect, test } from "bun:test";
import { contentOf, cut, firstRound, roundPieces, type WireEntry, type WirePart } from "../src/chunking";

const part = (id: string, type: string, content: string, status = "complete"): WirePart => ({
  id,
  type,
  status,
  data:
    type === "tool-call"
      ? { type, name: "exec", input: {}, output: content, status: "done" }
      : { type, text: content },
});
const entry = (seq: number, parts: WirePart[], status = "complete"): WireEntry => ({
  message: { id: `m${seq}`, seq, status },
  parts,
});

/** Runs every round and returns each part's reassembled content, plus how many rounds it took. */
function rebuild(entries: WireEntry[], partChars: number, budget: number) {
  const have = new Map<string, string>();
  for (const e of firstRound(entries, partChars, budget)) {
    for (const p of e.parts) have.set(p.id, contentOf(p) ?? "");
  }
  let rounds = 0;
  for (let r = 1; r < 1000; r++) {
    const { pieces, done } = roundPieces(entries, partChars, budget, r);
    for (const piece of pieces) {
      expect(piece.at).toBe((have.get(piece.id) ?? "").length);
      have.set(piece.id, (have.get(piece.id) ?? "") + piece.text);
    }
    rounds = r;
    if (done) break;
  }
  return { have, rounds };
}

describe("cut", () => {
  test("never splits a surrogate pair, and always makes progress", () => {
    const text = "ab\u{1F600}cd";
    expect(cut(text, 0, 3)).toBe("ab");
    expect(cut(text, 2, 1)).toBe("\u{1F600}");
    expect(cut(text, 0, 100)).toBe(text);
    expect(cut(text, 5, 10)).toBe("d");
  });
});

describe("first round", () => {
  test("parts that fit travel whole and unmarked; long ones are cut and say how long they are", () => {
    const [e] = firstRound(
      [entry(1, [part("a", "text", "short"), part("b", "text", "x".repeat(2000))])],
      500,
      10_000,
    );
    expect(e?.parts[0]).toEqual(part("a", "text", "short"));
    expect(contentOf(e?.parts[1] as WirePart)).toHaveLength(500);
    expect(e?.parts[1]?.partial).toBe(2000);
  });

  test("what the model said is sent before tool output, whatever the message order", () => {
    const entries = [
      entry(1, [part("said-old", "text", "o".repeat(400))]),
      entry(2, [part("tool-new", "tool-call", "t".repeat(400)), part("said-new", "text", "n".repeat(400))]),
    ];
    const out = firstRound(entries, 500, 800).flatMap((e) => e.parts);
    const by = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(contentOf(by["said-new"] as WirePart)).toHaveLength(400);
    expect(contentOf(by["said-old"] as WirePart)).toHaveLength(400);
    expect(contentOf(by["tool-new"] as WirePart)).toBe("");
    expect(by["tool-new"]?.partial).toBe(400);
  });

  test("the newest message's parts come first inside each kind", () => {
    const entries = [
      entry(1, [part("old", "text", "o".repeat(400))]),
      entry(2, [part("new", "text", "n".repeat(400))]),
    ];
    const out = Object.fromEntries(
      firstRound(entries, 500, 400)
        .flatMap((e) => e.parts)
        .map((p) => [p.id, p]),
    );
    expect(contentOf(out.new as WirePart)).toHaveLength(400);
    expect(out.old?.partial).toBe(400);
  });

  test("streaming messages and parts, other part types and the input are never cut", () => {
    const live = entry(1, [part("a", "text", "x".repeat(2000))], "streaming");
    const mixed = entry(2, [
      part("b", "text", "y".repeat(2000), "streaming"),
      { id: "n", type: "notice", data: { type: "notice", text: "z".repeat(2000) } },
    ]);
    const out = firstRound([live, mixed], 500, 10_000);
    expect(out[0]?.parts[0]?.partial).toBeUndefined();
    expect(contentOf(out[0]?.parts[0] as WirePart)).toHaveLength(2000);
    expect(out[1]?.parts.map((p) => p.partial)).toEqual([undefined, undefined]);
    expect(firstRound([live], 500, 10_000)[0]?.parts[0]).toBe(live.parts[0] as WirePart);
  });

  test("the entries it was given are left untouched", () => {
    const original = entry(1, [part("a", "text", "x".repeat(2000))]);
    firstRound([original], 500, 10_000);
    expect(contentOf(original.parts[0] as WirePart)).toHaveLength(2000);
    expect(original.parts[0]?.partial).toBeUndefined();
  });
});

describe("rounds", () => {
  const long = (n: number, ch: string) => ch.repeat(n);

  test("every round after the first, put together, rebuilds each part exactly", () => {
    const entries = [
      entry(1, [part("t1", "tool-call", long(9000, "a")), part("s1", "text", long(3300, "b"))]),
      entry(2, [
        part("s2", "text", `${long(1999, "c")}\u{1F600}${long(1000, "d")}`),
        part("t2", "tool-call", long(700, "e")),
      ]),
    ];
    const { have, rounds } = rebuild(entries, 1000, 2500);
    for (const e of entries) for (const p of e.parts) expect(have.get(p.id)).toBe(contentOf(p) ?? undefined);
    expect(rounds).toBeGreaterThan(1);
  });

  test("a lone huge part is not held to one piece per round: later rounds spend their whole budget on it", () => {
    const entries = [entry(1, [part("big", "tool-call", long(100_000, "x"))])];
    const first = firstRound(entries, 1000, 10_000)[0]?.parts[0] as WirePart;
    expect(contentOf(first)).toHaveLength(1000);
    const second = roundPieces(entries, 1000, 10_000, 1);
    expect(second.pieces).toHaveLength(10);
    expect(second.pieces.reduce((n, p) => n + p.text.length, 0)).toBe(10_000);
    expect(second.pieces.map((p) => p.at)).toEqual(Array.from({ length: 10 }, (_, i) => 1000 + i * 1000));
    const { rounds } = rebuild(entries, 1000, 10_000);
    expect(rounds).toBeLessThan(15);
  });

  test("no round is bigger than the budget, and no piece is longer than a part allows", () => {
    const entries = [
      entry(1, [part("a", "text", long(50_000, "x")), part("b", "tool-call", long(50_000, "y"))]),
    ];
    for (let r = 0; r < 6; r++) {
      const { pieces } = roundPieces(entries, 1000, 2500, r);
      expect(pieces.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2500);
      for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(1001);
    }
  });

  test("text keeps going before tool output in later rounds too", () => {
    const entries = [
      entry(1, [part("tool", "tool-call", long(5000, "t")), part("said", "text", long(5000, "s"))]),
    ];
    const first = roundPieces(entries, 1000, 1000, 1);
    expect(first.pieces.map((p) => p.id)).toEqual(["said"]);
    expect(roundPieces(entries, 1000, 1000, 4).pieces.map((p) => p.id)).toEqual(["said"]);
    expect(roundPieces(entries, 1000, 1000, 5).pieces.map((p) => p.id)).toEqual(["tool"]);
  });

  test("asking past the end gets nothing and done", () => {
    const entries = [entry(1, [part("a", "text", long(1500, "x"))])];
    expect(roundPieces(entries, 1000, 1000, 1).done).toBe(true);
    expect(roundPieces(entries, 1000, 1000, 9)).toEqual({ pieces: [], done: true });
  });

  test("a page with nothing cut has nothing to fill", () => {
    const entries = [entry(1, [part("a", "text", "hi")])];
    expect(roundPieces(entries, 1000, 1000, 1)).toEqual({ pieces: [], done: true });
  });
});
