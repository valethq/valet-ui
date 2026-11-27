import { describe, expect, test } from "bun:test";
import { type Block, type Inline, type ListItem, parseMarkdown } from "../src/app/markdown";

const p = (text: string): Block => ({ type: "p", children: [{ type: "text", text }] });
const li = (text: string, checked: boolean | null = null): ListItem => ({ checked, children: [p(text)] });

describe("parseMarkdown", () => {
  test("chat shortcodes work in prose and emphasis, including adjacent aliases and suffixes", () => {
    expect(
      parseMarkdown("I’m :sob:ing **:+1:** :heart::joy: :unknown_emoji:", { emojiShortcodes: true }),
    ).toEqual([
      {
        type: "p",
        children: [
          { type: "text", text: "I’m 😭ing " },
          { type: "strong", children: [{ type: "text", text: "👍" }] },
          { type: "text", text: " ❤️😂 :unknown_emoji:" },
        ],
      },
    ]);
    expect(parseMarkdown(":sob:")).toEqual([p(":sob:")]);
  });

  test("chat shortcodes preserve escapes, code, and link destinations", () => {
    const input = "\\:sob: `:sob:` [:sob:](https://example.org/:sob:)\n\n```\n:sob:\n```";
    expect(parseMarkdown(input, { emojiShortcodes: true })).toEqual([
      {
        type: "p",
        children: [
          { type: "text", text: ":sob: " },
          { type: "code", text: ":sob:" },
          { type: "text", text: " " },
          { type: "link", href: "https://example.org/:sob:", children: [{ type: "text", text: "😭" }] },
        ],
      },
      { type: "pre", text: ":sob:" },
    ]);
  });

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
    for (const s of ["[x](javascript:alert(1))", "[x](JavaScript:alert(1))", "[x](//evil.com)"]) {
      expect(parseMarkdown(s)).toEqual([{ type: "p", children: [{ type: "text", text: s }] }]);
    }
  });

  test("local destinations become file links with their line references", () => {
    const file = (s: string) => (parseMarkdown(s)[0] as { children: unknown[] }).children[0];
    expect(file("[x](file:///etc/passwd)")).toEqual({
      type: "file",
      ref: { path: "/etc/passwd" },
      auto: false,
      children: [{ type: "text", text: "x" }],
    });
    expect(file("[src/a.ts:12](src/a.ts:12)")).toEqual({
      type: "file",
      ref: { path: "src/a.ts", line: 12 },
      auto: true,
      children: [{ type: "text", text: "src/a.ts:12" }],
    });
    expect(file("[`a.ts`](a.ts#L3-L9)")).toMatchObject({
      ref: { path: "a.ts", line: 3, end: 9 },
      auto: false,
    });
    expect(file("[md-render.ts:10-20](src/app/md-render.ts)")).toMatchObject({
      ref: { path: "src/app/md-render.ts", line: 10, end: 20 },
    });
    expect(file("![shot](img/a.png)")).toMatchObject({ type: "file", ref: { path: "img/a.png" } });
    expect(parseMarkdown("[x](#top)")).toEqual([
      { type: "p", children: [{ type: "text", text: "[x](#top)" }] },
    ]);
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
    expect(parseMarkdown("- one\n- two")).toEqual([{ type: "ul", items: [li("one"), li("two")] }]);
    expect(parseMarkdown("* a\n+ b")).toEqual([{ type: "ul", items: [li("a"), li("b")] }]);
    expect(parseMarkdown("1. first\n2) second")).toEqual([
      { type: "ol", start: 1, items: [li("first"), li("second")] },
    ]);
    expect(parseMarkdown("3. third")).toEqual([{ type: "ol", start: 3, items: [li("third")] }]);
  });

  test("blockquote lines merge", () => {
    expect(parseMarkdown("> one\n> two\nafter")).toEqual([
      { type: "quote", children: [p("one\ntwo")] },
      p("after"),
    ]);
  });

  test("a github table parses head, alignment and body rows", () => {
    const blocks = parseMarkdown(
      "| n | prime | square | cube |\n| - | :---- | :----: | ---: |\n| 1 | 2 | 4 | 8 |\n| 2 | 3 | 9 | 27 |\n| 3 | 5 | 25 | 125 |",
    );
    const t = (text: string): Inline[] => [{ type: "text", text }];
    expect(blocks).toEqual([
      {
        type: "table",
        align: [null, "left", "center", "right"],
        head: [t("n"), t("prime"), t("square"), t("cube")],
        rows: [
          [t("1"), t("2"), t("4"), t("8")],
          [t("2"), t("3"), t("9"), t("27")],
          [t("3"), t("5"), t("25"), t("125")],
        ],
      },
    ]);
  });

  test("tables work without outer pipes and with inline markdown in cells", () => {
    const blocks = parseMarkdown("a | **b**\n--- | ---\n`x` | y");
    expect(blocks).toEqual([
      {
        type: "table",
        align: [null, null],
        head: [[{ type: "text", text: "a" }], [{ type: "strong", children: [{ type: "text", text: "b" }] }]],
        rows: [[[{ type: "code", text: "x" }], [{ type: "text", text: "y" }]]],
      },
    ]);
  });

  test("a table interrupts a paragraph and ends at a pipe-free line", () => {
    const blocks = parseMarkdown("intro\n| a |\n| - |\n| 1 |\ndone");
    expect(blocks).toEqual([
      { type: "p", children: [{ type: "text", text: "intro" }] },
      {
        type: "table",
        align: [null],
        head: [[{ type: "text", text: "a" }]],
        rows: [[[{ type: "text", text: "1" }]]],
      },
      { type: "p", children: [{ type: "text", text: "done" }] },
    ]);
  });

  test("lines with pipes but no delimiter row stay paragraphs", () => {
    expect(parseMarkdown("a | b")).toEqual([{ type: "p", children: [{ type: "text", text: "a | b" }] }]);
    expect(parseMarkdown("a | b\nnot a delimiter")).toEqual([
      { type: "p", children: [{ type: "text", text: "a | b\nnot a delimiter" }] },
    ]);
    // a delimiter row of the wrong width is no table either
    expect(parseMarkdown("a | b\n---")).toEqual([
      { type: "p", children: [{ type: "text", text: "a | b" }] },
      { type: "hr" },
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

const t = (text: string): Inline => ({ type: "text", text });
const link = (href: string, text: string, title?: string): Inline => ({
  type: "link",
  href,
  ...(title ? { title } : {}),
  children: [t(text)],
});
const para = (...children: Inline[]): Block => ({ type: "p", children });

describe("code fences", () => {
  test("tilde fences, longer closers and indented fences", () => {
    expect(parseMarkdown("~~~js\nx\n~~~")).toEqual([{ type: "pre", text: "x" }]);
    expect(parseMarkdown("````\n```\ninner\n```\n````")).toEqual([{ type: "pre", text: "```\ninner\n```" }]);
    expect(parseMarkdown("  ```\n  a\n   b\n  ```")).toEqual([{ type: "pre", text: "a\n b" }]);
  });

  test("triple backticks mid-line are not a fence and lose no text", () => {
    expect(parseMarkdown("Use ```js to start")).toEqual([para(t("Use ```js to start"))]);
    expect(parseMarkdown("a ```x``` b")).toEqual([para(t("a "), { type: "code", text: "x" }, t(" b"))]);
  });

  test("indented code blocks keep their text", () => {
    expect(parseMarkdown("intro\n\n    one\n\n      two\n\nafter")).toEqual([
      para(t("intro")),
      { type: "pre", text: "one\n\n  two" },
      para(t("after")),
    ]);
  });

  test("multi-backtick code spans may contain backticks", () => {
    expect(parseMarkdown("`` a`b ``")).toEqual([para({ type: "code", text: "a`b" })]);
  });
});

describe("rules and headings", () => {
  test("spaced and underscore rules", () => {
    for (const rule of ["* * *", "- - -", "___", "_ _ _", "  ***  "]) {
      expect(parseMarkdown(rule)).toEqual([{ type: "hr" }]);
    }
  });

  test("closing hashes are dropped", () => {
    expect(parseMarkdown("## Title ##")).toEqual([{ type: "h", level: 2, children: [t("Title")] }]);
    expect(parseMarkdown("# C#")).toEqual([{ type: "h", level: 1, children: [t("C#")] }]);
    expect(parseMarkdown("## ##")).toEqual([{ type: "h", level: 2, children: [] }]);
  });

  test("setext H1 with === underline, multi-line text allowed", () => {
    expect(parseMarkdown("Title\n=====")).toEqual([{ type: "h", level: 1, children: [t("Title")] }]);
    expect(parseMarkdown("a\nb\n===")).toEqual([{ type: "h", level: 1, children: [t("a\nb")] }]);
    // `---` under text stays a rule (kept from the original tests)
    expect(parseMarkdown("Title\n---")).toEqual([para(t("Title")), { type: "hr" }]);
  });
});

describe("emphasis", () => {
  test("spaced stars are literal", () => {
    expect(parseMarkdown("2 * 3 * 4")).toEqual([para(t("2 * 3 * 4"))]);
    expect(parseMarkdown("a * b")).toEqual([para(t("a * b"))]);
  });

  test("bold italic with three stars", () => {
    expect(parseMarkdown("***both***")).toEqual([
      para({ type: "em", children: [{ type: "strong", children: [t("both")] }] }),
    ]);
  });

  test("emphasis spans lines, for stars and underscores alike", () => {
    expect(parseMarkdown("*a\nb*")).toEqual([para({ type: "em", children: [t("a\nb")] })]);
    expect(parseMarkdown("**a\nb**")).toEqual([para({ type: "strong", children: [t("a\nb")] })]);
  });

  test("nested and adjacent emphasis", () => {
    expect(parseMarkdown("*a **b** c*")).toEqual([
      para({ type: "em", children: [t("a "), { type: "strong", children: [t("b")] }, t(" c")] }),
    ]);
    expect(parseMarkdown("**a**b")).toEqual([para({ type: "strong", children: [t("a")] }, t("b"))]);
  });

  test("single and double tilde strikethrough, loose tildes stay literal", () => {
    expect(parseMarkdown("~a~ ~~b~~")).toEqual([
      para({ type: "del", children: [t("a")] }, t(" "), { type: "del", children: [t("b")] }),
    ]);
    expect(parseMarkdown("about ~5 to ~10")).toEqual([para(t("about ~5 to ~10"))]);
  });

  test("underscores inside identifiers stay literal", () => {
    expect(parseMarkdown("some_var_name and __init__.py")).toEqual([
      para(t("some_var_name and "), { type: "strong", children: [t("init")] }, t(".py")),
    ]);
  });
});

describe("escapes, entities and breaks", () => {
  test("backslash escapes make punctuation literal", () => {
    expect(parseMarkdown("\\*not italic\\*")).toEqual([para(t("*not italic*"))]);
    expect(parseMarkdown("\\_x\\_ \\[a\\](b) \\# \\\\")).toEqual([para(t("_x_ [a](b) # \\"))]);
    expect(parseMarkdown("a\\b")).toEqual([para(t("a\\b"))]);
  });

  test("entities decode to text, never markup", () => {
    expect(parseMarkdown("Tom &amp; Jerry &copy; &#65;&#x42; &lt;b&gt;")).toEqual([
      para(t("Tom & Jerry © AB <b>")),
    ]);
    expect(parseMarkdown("&bogus; &#0;")).toEqual([para(t("&bogus; �"))]);
  });

  test("hard breaks drop their marker", () => {
    expect(parseMarkdown("one\\\ntwo")).toEqual([para(t("one\ntwo"))]);
    expect(parseMarkdown("one  \ntwo")).toEqual([para(t("one\ntwo"))]);
  });
});

describe("links", () => {
  test("titles are split from the destination", () => {
    expect(parseMarkdown('[a](https://x.com "the title")')).toEqual([
      para(link("https://x.com", "a", "the title")),
    ]);
    expect(parseMarkdown("[a](https://x.com 'single')")).toEqual([
      para(link("https://x.com", "a", "single")),
    ]);
  });

  test("destinations may hold balanced parens or sit in angle brackets", () => {
    expect(parseMarkdown("[w](https://en.wikipedia.org/wiki/Foo_(bar)) done")).toEqual([
      para(link("https://en.wikipedia.org/wiki/Foo_(bar)", "w"), t(" done")),
    ]);
    expect(parseMarkdown("[a](<https://x.com/a b>)")).toEqual([para(link("https://x.com/a b", "a"))]);
  });

  test("link text may hold brackets, emphasis and code, but never another link", () => {
    expect(parseMarkdown("[a [b] **c**](https://x.com)")).toEqual([
      {
        type: "p",
        children: [
          {
            type: "link",
            href: "https://x.com",
            children: [t("a [b] "), { type: "strong", children: [t("c")] }],
          },
        ],
      },
    ]);
    expect(parseMarkdown("[https://a.com](https://b.com)")).toEqual([
      para(link("https://b.com", "https://a.com")),
    ]);
  });

  test("reference links, collapsed and shortcut forms; definitions leave no text", () => {
    const src = "[text][ref] and [Ref][] and [ref]\n\n[ref]: https://x.com 'T'";
    expect(parseMarkdown(src)).toEqual([
      para(
        link("https://x.com", "text", "T"),
        t(" and "),
        link("https://x.com", "Ref", "T"),
        t(" and "),
        link("https://x.com", "ref", "T"),
      ),
    ]);
    expect(parseMarkdown("[nope][missing] [x]")).toEqual([para(t("[nope][missing] [x]"))]);
  });

  test("a definition with an unsafe scheme stays literal", () => {
    expect(parseMarkdown("[x][r]\n\n[r]: javascript:alert(1)")).toEqual([para(t("[x][r]"))]);
  });

  test("images become inert links labelled with their alt text", () => {
    expect(parseMarkdown("![alt text](https://x.com/a.png)")).toEqual([
      para(link("https://x.com/a.png", "alt text")),
    ]);
    expect(parseMarkdown("![](https://x.com/a.png)")).toEqual([para(link("https://x.com/a.png", "image"))]);
    expect(parseMarkdown("![a](data:image/png;base64,AAAA)")).toEqual([
      para(t("![a](data:image/png;base64,AAAA)")),
    ]);
  });

  test("angle autolinks for urls and emails; unsafe schemes and html stay literal", () => {
    expect(parseMarkdown("<https://x.com> <a@b.com>")).toEqual([
      para(link("https://x.com", "https://x.com"), t(" "), link("mailto:a@b.com", "a@b.com")),
    ]);
    expect(parseMarkdown("<javascript:alert(1)>")).toEqual([para(t("<javascript:alert(1)>"))]);
  });

  test("bare urls: www, any case, emails, trailing punctuation and balanced parens", () => {
    expect(parseMarkdown("see www.example.com/a, HTTPS://X.COM.")).toEqual([
      para(
        t("see "),
        link("https://www.example.com/a", "www.example.com/a"),
        t(", "),
        link("HTTPS://X.COM", "HTTPS://X.COM"),
        t("."),
      ),
    ]);
    expect(parseMarkdown("mail a.b@c.io now")).toEqual([
      para(t("mail "), link("mailto:a.b@c.io", "a.b@c.io"), t(" now")),
    ]);
    expect(parseMarkdown("https://en.wikipedia.org/wiki/Foo_(bar) and (https://x.com/y)")).toEqual([
      para(
        link("https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"),
        t(" and ("),
        link("https://x.com/y", "https://x.com/y"),
        t(")"),
      ),
    ]);
  });

  test("version pins and file names are not emails", () => {
    for (const s of ["react@18.2.0", "logo@2x.png", "@valethq/sdk"]) {
      expect(parseMarkdown(s)).toEqual([para(t(s))]);
    }
  });

  test("a trailing star is not part of a bare url", () => {
    expect(parseMarkdown("*https://x.com/a*")).toEqual([
      para({ type: "em", children: [link("https://x.com/a", "https://x.com/a")] }),
    ]);
  });
});

describe("lists", () => {
  test("nested lists, bullets and numbers mixed", () => {
    expect(parseMarkdown("- a\n  - b\n    - c\n- d")).toEqual([
      {
        type: "ul",
        items: [
          {
            checked: null,
            children: [
              p("a"),
              {
                type: "ul",
                items: [{ checked: null, children: [p("b"), { type: "ul", items: [li("c")] }] }],
              },
            ],
          },
          li("d"),
        ],
      },
    ]);
    expect(parseMarkdown("1. a\n  - b\n2. c")).toEqual([
      {
        type: "ol",
        start: 1,
        items: [{ checked: null, children: [p("a"), { type: "ul", items: [li("b")] }] }, li("c")],
      },
    ]);
  });

  test("indented continuation lines join the item; unindented text ends the list", () => {
    expect(parseMarkdown("- foo\n  bar\n- baz")).toEqual([
      { type: "ul", items: [li("foo\nbar"), li("baz")] },
    ]);
    expect(parseMarkdown("1. foo\n  bar")).toEqual([{ type: "ol", start: 1, items: [li("foo\nbar")] }]);
    expect(parseMarkdown("- foo\nbar")).toEqual([{ type: "ul", items: [li("foo")] }, p("bar")]);
  });

  test("items can hold several paragraphs and code, and blank lines keep one list", () => {
    expect(parseMarkdown("1. one\n\n   more\n\n   ```\n   code\n   ```\n\n2. two")).toEqual([
      {
        type: "ol",
        start: 1,
        items: [{ checked: null, children: [p("one"), p("more"), { type: "pre", text: "code" }] }, li("two")],
      },
    ]);
  });

  test("task lists", () => {
    expect(parseMarkdown("- [ ] todo\n- [x] done\n- [X] Done\n- [link](https://x.com)")).toEqual([
      {
        type: "ul",
        items: [
          li("todo", false),
          li("done", true),
          li("Done", true),
          { checked: null, children: [para(link("https://x.com", "link"))] },
        ],
      },
    ]);
  });

  test("only a list starting at 1 can interrupt a paragraph", () => {
    expect(parseMarkdown("in\n2. no")).toEqual([p("in\n2. no")]);
    expect(parseMarkdown("in\n1. yes")).toEqual([p("in"), { type: "ol", start: 1, items: [li("yes")] }]);
    expect(parseMarkdown("in\n- yes")).toEqual([p("in"), { type: "ul", items: [li("yes")] }]);
  });
});

describe("blockquotes", () => {
  test("nested quotes, lists, code and paragraphs inside a quote", () => {
    expect(parseMarkdown("> > deep")).toEqual([
      { type: "quote", children: [{ type: "quote", children: [p("deep")] }] },
    ]);
    expect(parseMarkdown("> - item\n> - two")).toEqual([
      { type: "quote", children: [{ type: "ul", items: [li("item"), li("two")] }] },
    ]);
    expect(parseMarkdown("> a\n>\n> b")).toEqual([{ type: "quote", children: [p("a"), p("b")] }]);
    expect(parseMarkdown("> ```\n> x\n> ```")).toEqual([
      { type: "quote", children: [{ type: "pre", text: "x" }] },
    ]);
    expect(parseMarkdown("> # h")).toEqual([
      { type: "quote", children: [{ type: "h", level: 1, children: [t("h")] }] },
    ]);
  });
});

describe("footnotes", () => {
  test("references number in order of first use and the notes follow the document", () => {
    expect(parseMarkdown("b[^b] a[^a] b2[^b]\n\n[^a]: first\n[^b]: second\n    more")).toEqual([
      para(t("b"), { type: "footnote", n: 1 }, t(" a"), { type: "footnote", n: 2 }, t(" b2"), {
        type: "footnote",
        n: 1,
      }),
      { type: "footnotes", items: [[p("second\nmore")], [p("first")]] },
    ]);
  });

  test("unknown references and unreferenced definitions", () => {
    expect(parseMarkdown("x[^zz]")).toEqual([para(t("x[^zz]"))]);
    expect(parseMarkdown("plain\n\n[^a]: unused")).toEqual([p("plain")]);
  });

  test("a note that cites itself terminates", () => {
    expect(parseMarkdown("x[^a]\n\n[^a]: loop[^a]")).toEqual([
      para(t("x"), { type: "footnote", n: 1 }),
      { type: "footnotes", items: [[para(t("loop"), { type: "footnote", n: 1 })]] },
    ]);
  });
});

describe("safety and limits", () => {
  test("raw html, math and unsafe destinations stay literal text", () => {
    expect(parseMarkdown("<br> <b>x</b>")).toEqual([para(t("<br> <b>x</b>"))]);
    expect(parseMarkdown("$x^2$ and $$y$$")).toEqual([para(t("$x^2$ and $$y$$"))]);
    expect(parseMarkdown("[x](vbscript:y) [z](data:text/html,a)")).toEqual([
      para(t("[x](vbscript:y) [z](data:text/html,a)")),
    ]);
  });

  test("deeply nested quotes and lists do not blow the stack", () => {
    expect(parseMarkdown(`${">".repeat(5000)} deep`).length).toBe(1);
    expect(parseMarkdown(`${"- ".repeat(5000)}deep`).length).toBe(1);
    expect(parseMarkdown("[".repeat(20000)).length).toBe(1);
    expect(parseMarkdown("*a ".repeat(20000)).length).toBe(1);
  });

  test("tables nested in lists and quotes, with escaped pipes and links in cells", () => {
    const src = "> | a | b |\n> | - | - |\n> | `x\\|y` | [l](https://x.com) |";
    const [q] = parseMarkdown(src);
    expect(q?.type).toBe("quote");
    const inner = (q as Extract<Block, { type: "quote" }>).children[0] as Extract<Block, { type: "table" }>;
    expect(inner.type).toBe("table");
    expect(inner.rows[0]).toEqual([[{ type: "code", text: "x|y" }], [link("https://x.com", "l")]]);
  });
});

describe("stream links", () => {
  const ref = { kind: "vnc" as const, host: "127.0.0.1", port: 5920 };

  test("explicit and bare vnc links become stream nodes", () => {
    expect(parseMarkdown("[watch](vnc://127.0.0.1:5920)")[0]).toEqual({
      type: "p",
      children: [{ type: "stream", ref, auto: false, children: [{ type: "text", text: "watch" }] }],
    });
    expect(parseMarkdown("watch vnc://127.0.0.1:5920 now")[0]).toEqual({
      type: "p",
      children: [
        { type: "text", text: "watch " },
        {
          type: "stream",
          ref,
          auto: true,
          children: [{ type: "text", text: "vnc://127.0.0.1:5920" }],
        },
        { type: "text", text: " now" },
      ],
    });
  });

  test("non-loopback vnc links stay literal", () => {
    const s = "[watch](vnc://example.com:5920)";
    expect(parseMarkdown(s)).toEqual([{ type: "p", children: [{ type: "text", text: s }] }]);
  });
});
