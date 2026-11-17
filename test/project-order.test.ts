import { describe, expect, test } from "bun:test";
import { applyOrder, moveItem } from "../src/app/project-order";

const p = (id: string) => ({ id });

describe("applyOrder", () => {
  test("sorts by the saved order", () => {
    expect(applyOrder([p("a"), p("b"), p("c")], ["c", "a", "b"]).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  test("unknown projects follow in server order; stale ids are ignored", () => {
    expect(applyOrder([p("a"), p("n1"), p("b"), p("n2")], ["gone", "b", "a"]).map((x) => x.id)).toEqual([
      "b",
      "a",
      "n1",
      "n2",
    ]);
  });
});

describe("moveItem", () => {
  test("moves and clamps", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, 3)).toEqual([1, 2, 3]);
  });
});
