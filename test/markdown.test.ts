import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../src/app/markdown";

describe("parseMarkdown", () => {
  test("plain text becomes paragraphs split on blank lines", () => {
    const blocks = parseMarkdown("one\nline\n\ntwo");
    expect(blocks).toEqual([
      { type: "p", children: [{ type: "text", text: "one\nline" }] },
      { type: "p", children: [{ type: "text", text: "two" }] },
    ]);
  });

  test("fenced code blocks, with and without a language tag", () => {
    const blocks = parseMarkdown("before\n```ts\nconst x = 1;\n```\nafter");
    expect(blocks).toEqual([
      { type: "p", children: [{ type: "text", text: "before" }] },
      { type: "pre", text: "const x = 1;" },
      { type: "p", children: [{ type: "text", text: "after" }] },
    ]);
  });

  test("an unclosed fence still yields a code block", () => {
    const blocks = parseMarkdown("```\nunclosed");
    expect(blocks).toEqual([{ type: "pre", text: "unclosed" }]);
  });

  test("inline code spans within paragraphs", () => {
    const blocks = parseMarkdown("run `bun test` now");
    expect(blocks).toEqual([
      {
        type: "p",
        children: [
          { type: "text", text: "run " },
          { type: "code", text: "bun test" },
          { type: "text", text: " now" },
        ],
      },
    ]);
  });

  test("a lone backtick stays literal text", () => {
    const blocks = parseMarkdown("a ` b");
    expect(blocks).toEqual([{ type: "p", children: [{ type: "text", text: "a ` b" }] }]);
  });

  test("HTML in the input is never markup, only text", () => {
    for (const input of [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "a <b>bold</b> `<i>x</i>`",
    ]) {
      for (const block of parseMarkdown(input)) {
        expect(["p", "pre"]).toContain(block.type);
        if (block.type === "p") {
          for (const child of block.children) expect(["text", "code"]).toContain(child.type);
        }
      }
    }
    const [p] = parseMarkdown("<script>alert(1)</script>");
    expect(p).toEqual({ type: "p", children: [{ type: "text", text: "<script>alert(1)</script>" }] });
  });

  test("HTML inside code spans and fences stays literal", () => {
    const blocks = parseMarkdown("`<div>`\n\n```\n<span>hi</span>\n```");
    expect(blocks[0]).toEqual({ type: "p", children: [{ type: "code", text: "<div>" }] });
    expect(blocks[1]).toEqual({ type: "pre", text: "<span>hi</span>" });
  });
});
