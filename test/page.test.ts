import { describe, expect, test } from "bun:test";
import { indexHtml } from "../src/page";

const html = indexHtml();

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

  test("failed tool status and send errors use the theme's danger colour", () => {
    expect(html).toContain(".part-row .status.failed { color: var(--danger); }");
    expect(/\.hint\.send-error \{[^}]*color: var\(--danger\)/.test(html)).toBe(true);
  });

  test("the stored theme applies from the head before the app loads", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('localStorage.getItem("valet-ui.theme")');
    expect(head).toContain('html[data-theme="paper"]');
  });
});
