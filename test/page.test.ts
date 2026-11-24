import { describe, expect, test } from "bun:test";
import { indexHtml } from "../src/page";

const html = indexHtml();

describe("page css", () => {
  test("sidebar titles are one line, with the status dot beside the time and unread shown as weight", () => {
    const title = /\.session-row \.title \{[^}]*\}/.exec(html)?.[0] ?? "";
    expect(title).toContain("white-space: nowrap");
    expect(title).toContain("text-overflow: ellipsis");
    expect(html).toContain(".session-row .meta { display: flex; align-items: center;");
    expect(html).toContain('.session-row[data-unread="1"] .title { font-weight: 550; }');
    expect(html).not.toContain(".session-row .unread");
  });

  test("the chat header lines up with the content column and spreads out on mobile", () => {
    const header = /\.chat-header \{[^}]*\}/.exec(html)?.[0] ?? "";
    expect(header).toContain("max(16px, calc((100% - 812px) / 2))");
    expect(html).toContain("justify-content: space-between; padding: max(8px, env(safe-area-inset-top))");
    expect(html).toContain(
      ".chat-header .session-title { display: block; white-space: nowrap; text-overflow: ellipsis; }",
    );
  });

  test("messages fade out above the composer, mirroring the header fade", () => {
    expect(html).toContain(".composer-wrap { position: relative;");
    expect(html).toContain("background: linear-gradient(transparent, var(--bg) 90%);");
    expect(html).toContain(".main[data-landing] .composer-wrap::before { display: none; }");
  });

  test("the session three-dot button shows on hover and is always visible on touch", () => {
    expect(html).toContain(".session-item .row-more { position: absolute;");
    expect(html).toContain(".session-item:hover .row-more");
    expect(html).toContain("top: calc(50% - 21px); bottom: auto; right: 0;");
    expect(html).toContain("@media (hover: none) { .session-item .row-more { opacity: 1; } }");
    expect(html).toContain(".menu.session-menu { position: fixed;");
  });

  test("failed tool status and send errors use the theme's danger colour", () => {
    expect(html).toContain(".part-row .status.failed { color: var(--danger); }");
    expect(/\.hint\.send-error \{[^}]*color: var\(--danger\)/.test(html)).toBe(true);
  });

  test("the new-chat screen centers the greeting and composer together", () => {
    expect(html).toContain(".main[data-landing] { justify-content: center; }");
    expect(html).toContain(".main[data-landing] .messages { flex: none;");
  });

  test("mobile keeps margins and the same max content width as desktop", () => {
    const mobile = html.slice(html.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".composer-wrap { padding: 2px max(16px, calc((100% - 812px) / 2))");
    expect(mobile).toContain(
      ".messages { padding: calc(2 * 1.35em + 40px + env(safe-area-inset-top)) max(16px, calc((100% - 812px) / 2))",
    );
  });

  test("mobile browsers do not inflate long text blocks such as tool output", () => {
    expect(html).toContain("html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }");
  });

  test("the theme studio splits in two on desktop and still respects hidden", () => {
    expect(html).toContain(".theme-studio[hidden] { display: none; }");
    expect(html).toContain(".theme-studio { display: grid; grid-template-columns: 304px minmax(0, 1fr);");
    const mobile = html.slice(html.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".theme-studio { display: block; }");
    expect(mobile).toContain("grid-auto-flow: column;");
  });

  test("the stored theme applies from the head before the app loads", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('localStorage.getItem("valet-ui.theme")');
    expect(head).toContain('html[data-theme="paper"]');
  });

  test("the model picker names its harness with a small greyed mark", () => {
    const title = /\.menu-title \{[^}]*\}/.exec(html)?.[0] ?? "";
    expect(title).toContain("display: flex");
    expect(title).toContain("align-items: center");
    expect(title).toContain("gap: 6px");
    expect(html).toContain(".menu-title .logo { width: 14px; height: 14px; filter: grayscale(1); }");
  });
});
