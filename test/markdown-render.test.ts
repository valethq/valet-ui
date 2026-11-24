import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/app/markdown";

class FakeText {
  constructor(readonly text: string) {}
}

class FakeEl {
  children: (FakeEl | FakeText)[] = [];
  className = "";
  href = "";
  title = "";
  type = "";
  checked = false;
  disabled = false;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  constructor(readonly tag: string) {}
  set textContent(text: string) {
    this.children = [new FakeText(text)];
  }
  append(...nodes: (FakeEl | FakeText)[]): void {
    this.children.push(...nodes);
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(): void {}
  set innerHTML(_: string) {}
}

function ser(n: FakeEl | FakeText): string {
  if (n instanceof FakeText) return n.text;
  const flags = [
    n.className && `.${n.className}`,
    n.href && ` href=${n.href}`,
    n.title && ` title=${n.title}`,
    n.type === "checkbox" && (n.checked ? " [x]" : " [ ]"),
    n.attrs.start && ` start=${n.attrs.start}`,
    n.attrs["data-path"] && ` path=${n.attrs["data-path"]}`,
    n.attrs["data-line"] && ` line=${n.attrs["data-line"]}`,
    n.attrs["data-end"] && ` end=${n.attrs["data-end"]}`,
    n.style.listStyle && " bare",
  ];
  return `<${n.tag}${flags.filter(Boolean).join("")}>${n.children.map(ser).join("")}</${n.tag}>`;
}

const g = globalThis as unknown as { document?: unknown };
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  g.document = {
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (text: string) => new FakeText(text),
  };
});
afterAll(() => {
  g.document = saved;
});

const html = (md: string): string => ser(renderMarkdown(md) as unknown as FakeEl);

describe("renderMarkdown", () => {
  test("tight lists inline their first paragraph; nested lists and code go inside the li", () => {
    expect(html("- a\n  - b\n- c")).toBe("<div><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul></div>");
    expect(html("1. a\n\n   ```\n   x\n   ```")).toBe(
      "<div><ol><li>a<div.code-block><pre><code>x</code></pre><button><span></span></button></div></li></ol></div>",
    );
    expect(html("3. a")).toBe("<div><ol start=3><li>a</li></ol></div>");
  });

  test("task items get a disabled checkbox and no bullet", () => {
    expect(html("- [x] done\n- [ ] todo")).toBe(
      "<div><ul><li bare><input [x]></input>done</li><li bare><input [ ]></input>todo</li></ul></div>",
    );
  });

  test("quotes hold blocks", () => {
    expect(html("> a\n>\n> - b")).toBe("<div><div.md-quote><p>a</p><ul><li>b</li></ul></div></div>");
  });

  test("footnote refs become superscripts and the notes follow a rule", () => {
    expect(html("x[^1]\n\n[^1]: note")).toBe(
      "<div><p>x<sup>1</sup></p><hr></hr><ol><li>note</li></ol></div>",
    );
  });

  test("links carry titles and open safely; images never become <img>", () => {
    expect(html('[a](https://x.com "t") ![i](https://x.com/i.png)')).toBe(
      "<div><p><a href=https://x.com title=t>a</a> <a href=https://x.com/i.png>i</a></p></div>",
    );
  });

  test("file links render as chips carrying their path and lines", () => {
    expect(html("[src/a.ts:3](src/a.ts:3) [the tests](test/x.ts#L1-L4)")).toBe(
      "<div><p><a.file-link mono title=src/a.ts:3 path=src/a.ts line=3><span></span><span>a.ts</span><span.ln>:3</span></a> " +
        "<a.file-link title=test/x.ts:1-4 path=test/x.ts line=1 end=4><span></span><span>the tests</span></a></p></div>",
    );
  });

  test("markup in the input is only ever text", () => {
    expect(html("<img src=x onerror=alert(1)> &lt;b&gt;")).toBe(
      "<div><p><img src=x onerror=alert(1)> <b></p></div>",
    );
  });
});
