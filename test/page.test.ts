import { describe, expect, test } from "bun:test";
import { indexHtml } from "../src/page";

const html = indexHtml("http://core.test");

describe("page css", () => {
  test("sidebar titles wrap to at most two lines", () => {
    expect(html).toContain("-webkit-line-clamp: 2");
    expect(html).toContain("-webkit-box-orient: vertical");
    expect(html).toContain("overflow-wrap: anywhere");
    const row = /\.session-row \{[^}]*\}/.exec(html)?.[0] ?? "";
    const title = /\.session-row \.title \{[^}]*\}/.exec(html)?.[0] ?? "";
    expect(row).not.toContain("white-space: nowrap");
    expect(title).not.toContain("text-overflow");
  });

  test("failed tool status and send errors render red", () => {
    expect(html).toContain(".part-row .status.failed { color: #e06c75; }");
    expect(html).toContain(".hint.send-error { padding: 6px 16px 0; color: #e06c75; }");
  });
});
