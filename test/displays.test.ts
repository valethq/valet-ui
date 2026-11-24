import { describe, expect, test } from "bun:test";
import {
  cleanDisplay,
  clampPercent,
  refreshInterval,
  renderDisplays,
  safeHref,
} from "../src/app/views/displays";

describe("cleanDisplay", () => {
  test("a meter keeps its fields, clamps to 0-100 and defaults the tone", () => {
    expect(
      cleanDisplay({
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
    expect(cleanDisplay({ type: "meter", label: "x", value: "44" }).type).toBe("unknown");
    expect(cleanDisplay({ type: "meter", label: "x", value: Number.NaN }).type).toBe("unknown");
  });

  test("unknown tones fall back to normal; known ones pass", () => {
    expect(cleanDisplay({ type: "badge", text: "a", tone: "neon" })).toEqual({
      type: "badge",
      text: "a",
      tone: "normal",
    });
    expect(cleanDisplay({ type: "note", text: "a", tone: "critical" })).toEqual({
      type: "note",
      text: "a",
      tone: "critical",
    });
  });

  test("tables coerce cells to strings and tolerate ragged rows", () => {
    expect(cleanDisplay({ type: "table", columns: ["a", 2], rows: [["x", 1], "bad", [null]] })).toEqual({
      type: "table",
      columns: ["a", "2"],
      rows: [["x", "1"], [], [""]],
    });
  });

  test("actions need text and an action; args must be an object", () => {
    expect(cleanDisplay({ type: "action", text: "Go", action: "go", args: [1], confirm: "Sure?" })).toEqual({
      type: "action",
      text: "Go",
      action: "go",
      args: {},
      confirm: "Sure?",
      tone: "normal",
    });
    expect(cleanDisplay({ type: "action", text: "Go" }).type).toBe("unknown");
  });

  test("headings, dividers and links", () => {
    expect(cleanDisplay({ type: "heading", text: "H" })).toEqual({ type: "heading", text: "H" });
    expect(cleanDisplay({ type: "divider" })).toEqual({ type: "divider" });
    expect(cleanDisplay({ type: "link", text: "Docs", href: "https://x" })).toEqual({
      type: "link",
      text: "Docs",
      href: "https://x",
    });
    expect(cleanDisplay({ type: "link", text: "Docs" }).type).toBe("unknown");
    expect(safeHref("https://x")).toBe(true);
    expect(safeHref("/plugins/x")).toBe(true);
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("//evil")).toBe(false);
  });

  test("non-objects, v2 groups and newer types fall back to JSON", () => {
    expect(cleanDisplay("hi")).toEqual({ type: "unknown", json: '"hi"' });
    expect(cleanDisplay(undefined)).toEqual({ type: "unknown", json: "undefined" });
    expect(cleanDisplay({ type: "sparkline", points: [1] }).type).toBe("unknown");
    expect(cleanDisplay({ type: "group", blocks: [] }).type).toBe("unknown");
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

describe("renderDisplays", () => {
  class Node {
    attrs: Record<string, string> = {};
    children: Node[] = [];
    textContent = "";
    style: Record<string, string> = {};
    constructor(readonly tag: string) {}
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    }
    append(...kids: (Node | string)[]) {
      for (const k of kids) if (typeof k !== "string") this.children.push(k);
    }
    addEventListener() {}
  }
  const shape = (n: Node): string =>
    n.attrs.class === "blk-group row"
      ? `row(${n.children.map(shape).join(",")})`
      : ((n.attrs.class ?? n.tag).split(" ")[0] as string);

  test("a note between status items goes under their row instead of splitting it", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.document;
    g.document = { createElement: (tag: string) => new Node(tag) };
    try {
      const nodes = renderDisplays(
        [
          { type: "badge", text: "Public", tone: "warning" },
          { type: "stat", label: "Serving", value: "x" },
          { type: "note", text: "Anyone can reach it", tone: "warning" },
          { type: "stat", label: "URL", value: "y" },
          { type: "action", text: "Refresh", action: "refresh" },
          { type: "heading", text: "Usage" },
          { type: "note", text: "Plain note" },
        ],
        { run: async () => {} },
      ) as unknown as Node[];
      expect(nodes.map(shape)).toEqual([
        "row(blk-badge,blk-stat,blk-stat,blk-action)",
        "blk-text",
        "panel-title",
        "blk-text",
      ]);
    } finally {
      g.document = saved;
    }
  });
});
