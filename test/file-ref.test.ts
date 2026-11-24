import { expect, test } from "bun:test";
import { baseName, fileRef, joinPath, lineLabel, withLabelLines } from "../src/app/file-ref";

test("web, fragment and other-scheme links are not files", () => {
  for (const href of [
    "https://x.com",
    "mailto:a@b.c",
    "javascript:alert(1)",
    "#top",
    "?q=1",
    "//x.com",
    "",
  ]) {
    expect(fileRef(href)).toBeNull();
  }
});

test("paths with line references", () => {
  expect(fileRef("src/a.ts")).toEqual({ path: "src/a.ts" });
  expect(fileRef("/abs/a.ts:12")).toEqual({ path: "/abs/a.ts", line: 12 });
  expect(fileRef("a.ts:12:4")).toEqual({ path: "a.ts", line: 12 });
  expect(fileRef("a.ts:12-20")).toEqual({ path: "a.ts", line: 12, end: 20 });
  expect(fileRef("a.ts#L5")).toEqual({ path: "a.ts", line: 5 });
  expect(fileRef("a.ts#L5-L9")).toEqual({ path: "a.ts", line: 5, end: 9 });
  expect(fileRef("a.ts#L5C2-L9C1")).toEqual({ path: "a.ts", line: 5, end: 9 });
  expect(fileRef("a.ts#L9-L5")).toEqual({ path: "a.ts", line: 9 });
  expect(fileRef("README.md#usage")).toEqual({ path: "README.md" });
  expect(fileRef("file:///tmp/my%20file.txt")).toEqual({ path: "/tmp/my file.txt" });
  expect(fileRef("file://localhost/tmp/x")).toEqual({ path: "/tmp/x" });
  expect(fileRef("C:\\src\\a.ts:3")).toEqual({ path: "C:\\src\\a.ts", line: 3 });
});

test("names, joins and labels", () => {
  expect(baseName("src/app/a.ts")).toBe("a.ts");
  expect(baseName("src/app/")).toBe("app");
  expect(joinPath("docs", "../src/a.ts")).toBe("src/a.ts");
  expect(joinPath("docs", "./b.md")).toBe("docs/b.md");
  expect(joinPath("", "../x")).toBe("../x");
  expect(joinPath("docs", "../../x")).toBe("../x");
  expect(joinPath("docs", "/abs")).toBe("/abs");
  expect(lineLabel({ path: "a", line: 3, end: 5 })).toBe(":3-5");
  expect(lineLabel({ path: "a" })).toBe("");
});

test("a bare file name with a line is not a scheme", () => {
  expect(fileRef("a.ts:7")).toEqual({ path: "a.ts", line: 7 });
  expect(fileRef("data:text/html,x")).toBeNull();
});

test("link text ending in :line or :start-end supplies lines the destination lacks", () => {
  expect(withLabelLines({ path: "a.ts" }, "a.ts:10-20")).toEqual({ path: "a.ts", line: 10, end: 20 });
  expect(withLabelLines({ path: "a.ts" }, "`a.ts:7`")).toEqual({ path: "a.ts", line: 7 });
  expect(withLabelLines({ path: "a.ts", line: 3 }, "a.ts:10-20")).toEqual({ path: "a.ts", line: 3 });
  expect(withLabelLines({ path: "a.ts" }, "the parser")).toEqual({ path: "a.ts" });
});
