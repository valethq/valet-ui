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

  test("headings at line start, levels 1-6", () => {
    expect(parseMarkdown("# Title")).toEqual([
      { type: "h", level: 1, children: [{ type: "text", text: "Title" }] },
    ]);
    expect(parseMarkdown("###### Deep\nbody")).toEqual([
      { type: "h", level: 6, children: [{ type: "text", text: "Deep" }] },
      { type: "p", children: [{ type: "text", text: "body" }] },
    ]);
    expect(parseMarkdown("a\n# mid\nb")).toEqual([
      { type: "p", children: [{ type: "text", text: "a" }] },
      { type: "h", level: 1, children: [{ type: "text", text: "mid" }] },
      { type: "p", children: [{ type: "text", text: "b" }] },
    ]);
    expect(parseMarkdown("#not a heading")).toEqual([
      { type: "p", children: [{ type: "text", text: "#not a heading" }] },
    ]);
  });

  test("bold and italic", () => {
    expect(parseMarkdown("**bold**")).toEqual([
      { type: "p", children: [{ type: "strong", children: [{ type: "text", text: "bold" }] }] },
    ]);
    expect(parseMarkdown("__bold__")).toEqual([
      { type: "p", children: [{ type: "strong", children: [{ type: "text", text: "bold" }] }] },
    ]);
    expect(parseMarkdown("*it*")).toEqual([
      { type: "p", children: [{ type: "em", children: [{ type: "text", text: "it" }] }] },
    ]);
    expect(parseMarkdown("_it_")).toEqual([
      { type: "p", children: [{ type: "em", children: [{ type: "text", text: "it" }] }] },
    ]);
    expect(parseMarkdown("~~gone~~")).toEqual([
      { type: "p", children: [{ type: "del", children: [{ type: "text", text: "gone" }] }] },
    ]);
    // underscore emphasis does not trigger inside words
    expect(parseMarkdown("snake_case_name")).toEqual([
      { type: "p", children: [{ type: "text", text: "snake_case_name" }] },
    ]);
  });

  test("bold containing inline code nests", () => {
    expect(parseMarkdown("**run `bun test` now**")).toEqual([
      {
        type: "p",
        children: [
          {
            type: "strong",
            children: [
              { type: "text", text: "run " },
              { type: "code", text: "bun test" },
              { type: "text", text: " now" },
            ],
          },
        ],
      },
    ]);
  });

  test("links with safe schemes become link nodes", () => {
    expect(parseMarkdown("[docs](https://example.com/a?b=1)")).toEqual([
      {
        type: "p",
        children: [
          { type: "link", href: "https://example.com/a?b=1", children: [{ type: "text", text: "docs" }] },
        ],
      },
    ]);
    expect(parseMarkdown("[mail](mailto:a@b.c)")).toEqual([
      {
        type: "p",
        children: [{ type: "link", href: "mailto:a@b.c", children: [{ type: "text", text: "mail" }] }],
      },
    ]);
  });

  test("unsafe link schemes render literally", () => {
    for (const s of ["[x](javascript:alert(1))", "[x](file:///etc/passwd)"]) {
      expect(parseMarkdown(s)).toEqual([{ type: "p", children: [{ type: "text", text: s }] }]);
    }
  });

  test("bare https URLs autolink", () => {
    const blocks = parseMarkdown("see https://example.com/x now");
    expect(blocks).toEqual([
      {
        type: "p",
        children: [
          { type: "text", text: "see " },
          {
            type: "link",
            href: "https://example.com/x",
            children: [{ type: "text", text: "https://example.com/x" }],
          },
          { type: "text", text: " now" },
        ],
      },
    ]);
  });

  test("unordered and ordered lists", () => {
    expect(parseMarkdown("- one\n- two")).toEqual([
      { type: "ul", items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    ]);
    expect(parseMarkdown("* a\n+ b")).toEqual([
      { type: "ul", items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]] },
    ]);
    expect(parseMarkdown("1. first\n2) second")).toEqual([
      {
        type: "ol",
        start: 1,
        items: [[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]],
      },
    ]);
    expect(parseMarkdown("3. third")).toEqual([
      { type: "ol", start: 3, items: [[{ type: "text", text: "third" }]] },
    ]);
  });

  test("blockquote lines merge", () => {
    expect(parseMarkdown("> one\n> two\nafter")).toEqual([
      { type: "quote", children: [{ type: "text", text: "one\ntwo" }] },
      { type: "p", children: [{ type: "text", text: "after" }] },
    ]);
  });

  test("horizontal rules", () => {
    expect(parseMarkdown("a\n---\nb")).toEqual([
      { type: "p", children: [{ type: "text", text: "a" }] },
      { type: "hr" },
      { type: "p", children: [{ type: "text", text: "b" }] },
    ]);
    expect(parseMarkdown("***")).toEqual([{ type: "hr" }]);
  });
});
