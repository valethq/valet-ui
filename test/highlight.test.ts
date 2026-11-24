import { expect, test } from "bun:test";
import { highlightLines, langFor, type Lang, tokenize } from "../src/app/highlight";

const kinds = (text: string, lang: Lang) =>
  tokenize(text, lang)
    .filter((t) => t.kind !== "")
    .map((t) => `${t.kind}:${t.text}`);

test("picks languages by extension and file name", () => {
  expect(langFor("src/a.tsx")?.name).toBe("TypeScript");
  expect(langFor("x/Dockerfile")?.name).toBe("Shell");
  expect(langFor("README.md")?.name).toBe("Markdown");
  expect(langFor("LICENSE")).toBeNull();
});

test("colours TypeScript keywords, strings, numbers, calls, types and comments", () => {
  const ts = langFor("a.ts") as Lang;
  expect(kinds('const x: Foo = bar("s", 0x1f); // hi', ts)).toEqual([
    "k:const",
    "t:Foo",
    "f:bar",
    's:"s"',
    "n:0x1f",
    "c:// hi",
  ]);
  expect(kinds("a1 = `x\ny` /* c\nd */", ts)).toEqual(["s:`x\ny`", "c:/* c\nd */"]);
});

test("shell comments need a space before the hash; SQL keywords ignore case", () => {
  const sh = langFor("a.sh") as Lang;
  expect(kinds("echo $# # note", sh)).toEqual(["k:echo", "c:# note"]);
  expect(kinds("SELECT 1", langFor("q.sql") as Lang)).toEqual(["k:SELECT", "n:1"]);
});

test("splits tokens into lines, dropping the final newline", () => {
  const lines = highlightLines("/* a\nb */\nx\n", langFor("a.ts"));
  expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual(["/* a", "b */", "x"]);
  expect(highlightLines("plain\ntext", null)).toEqual([
    [{ kind: "", text: "plain" }],
    [{ kind: "", text: "text" }],
  ]);
  expect(highlightLines("", null)).toEqual([[]]);
});

test("regex literals are kept whole, division is not a regex", () => {
  const ts = langFor("a.ts") as Lang;
  expect(kinds("const Re = /[`'\"]\\//g; x", ts)).toEqual(["k:const", "t:Re", "s:/[`'\"]\\//g"]);
  expect(kinds("a / b / 2", ts)).toEqual(["n:2"]);
  expect(kinds("f(x) / 2 // c", ts)).toEqual(["f:f", "n:2", "c:// c"]);
});
