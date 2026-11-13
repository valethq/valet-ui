import { describe, expect, test } from "bun:test";
import { trackSeq } from "../src/app/ws";

describe("trackSeq", () => {
  test("the first frame for a topic is not a gap", () => {
    const seqs = new Map<string, number>();
    expect(trackSeq(seqs, "t", 1)).toBe(false);
    expect(trackSeq(seqs, "t", 7)).toBe(true);
    expect(seqs.get("t")).toBe(7);
  });

  test("consecutive seqs are not a gap", () => {
    const seqs = new Map<string, number>();
    expect(trackSeq(seqs, "t", 1)).toBe(false);
    expect(trackSeq(seqs, "t", 2)).toBe(false);
    expect(trackSeq(seqs, "t", 3)).toBe(false);
  });

  test("a skipped seq reports a gap once, then resumes", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "t", 1);
    expect(trackSeq(seqs, "t", 4)).toBe(true);
    expect(trackSeq(seqs, "t", 5)).toBe(false);
  });

  test("gaps are tracked per topic", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "a", 1);
    trackSeq(seqs, "b", 10);
    expect(trackSeq(seqs, "a", 3)).toBe(true);
    expect(trackSeq(seqs, "b", 11)).toBe(false);
  });

  test("a late or replayed frame is not a gap and does not rewind", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "t", 5);
    expect(trackSeq(seqs, "t", 3)).toBe(false);
    expect(trackSeq(seqs, "t", 5)).toBe(false);
    expect(trackSeq(seqs, "t", 6)).toBe(false);
    expect(seqs.get("t")).toBe(6);
  });
});
