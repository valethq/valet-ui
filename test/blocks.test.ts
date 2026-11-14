import { describe, expect, test } from "bun:test";
import { cleanBlock, clampPercent, refreshInterval } from "../src/app/views/blocks";

describe("cleanBlock", () => {
  test("a meter keeps its fields, clamps to 0-100 and defaults the tone", () => {
    expect(
      cleanBlock({
        type: "meter",
        label: "Session",
        value: 144,
        display: "44% left",
        marker: -5,
        status: "On pace",
      }),
    ).toEqual({
      type: "meter",
      label: "Session",
      value: 100,
      display: "44% left",
      marker: 0,
      status: "On pace",
      tone: "normal",
    });
  });

  test("a meter without a finite value is shown as JSON, not drawn as empty", () => {
    expect(cleanBlock({ type: "meter", label: "x", value: "44" }).type).toBe("unknown");
    expect(cleanBlock({ type: "meter", label: "x", value: Number.NaN }).type).toBe("unknown");
  });

  test("unknown tones fall back to normal; known ones pass", () => {
    expect(cleanBlock({ type: "badge", text: "a", tone: "neon" })).toEqual({
      type: "badge",
      text: "a",
      tone: "normal",
    });
    expect(cleanBlock({ type: "text", text: "a", tone: "critical" })).toEqual({
      type: "text",
      text: "a",
      tone: "critical",
    });
  });

  test("tables coerce cells to strings and tolerate ragged rows", () => {
    expect(cleanBlock({ type: "table", columns: ["a", 2], rows: [["x", 1], "bad", [null]] })).toEqual({
      type: "table",
      columns: ["a", "2"],
      rows: [["x", "1"], [], [""]],
    });
  });

  test("buttons need a label and an action; args must be an object", () => {
    expect(cleanBlock({ type: "button", label: "Go", action: "go", args: [1], confirm: "Sure?" })).toEqual({
      type: "button",
      label: "Go",
      action: "go",
      args: {},
      confirm: "Sure?",
      tone: "normal",
    });
    expect(cleanBlock({ type: "button", label: "Go" }).type).toBe("unknown");
  });

  test("groups clean their children and default to a stack", () => {
    expect(cleanBlock({ type: "group", blocks: [{ type: "text", text: "a" }, { type: "nope" }] })).toEqual({
      type: "group",
      layout: "stack",
      blocks: [
        { type: "text", text: "a", tone: "normal" },
        { type: "unknown", json: '{\n  "type": "nope"\n}' },
      ],
    });
    expect(cleanBlock({ type: "group", layout: "row", title: "T", blocks: [] })).toMatchObject({
      layout: "row",
      title: "T",
    });
  });

  test("nesting stops at a fixed depth", () => {
    let raw: unknown = { type: "text", text: "leaf" };
    for (let i = 0; i < 10; i++) raw = { type: "group", blocks: [raw] };
    let b = cleanBlock(raw);
    let depth = 0;
    while (b.type === "group") {
      depth++;
      b = b.blocks[0] as typeof b;
    }
    expect(depth).toBe(5);
    expect(b.type).toBe("unknown");
  });

  test("non-objects and newer block types fall back to JSON", () => {
    expect(cleanBlock("hi")).toEqual({ type: "unknown", json: '"hi"' });
    expect(cleanBlock(undefined)).toEqual({ type: "unknown", json: "undefined" });
    expect(cleanBlock({ type: "sparkline", points: [1] }).type).toBe("unknown");
  });
});

test("clampPercent rejects non-numbers", () => {
  expect(clampPercent(50)).toBe(50);
  expect(clampPercent(-1)).toBe(0);
  expect(clampPercent("5")).toBeUndefined();
  expect(clampPercent(Number.POSITIVE_INFINITY)).toBeUndefined();
});

test("refreshInterval is off unless a positive number, and never under a second", () => {
  expect(refreshInterval(undefined)).toBeUndefined();
  expect(refreshInterval(0)).toBeUndefined();
  expect(refreshInterval(-5)).toBeUndefined();
  expect(refreshInterval(50)).toBe(1000);
  expect(refreshInterval(30_000)).toBe(30_000);
});
