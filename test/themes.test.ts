import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, THEMES, themeCss } from "../src/app/themes";

describe("themes", () => {
  test("the default is a black and white preset", () => {
    expect(DEFAULT_THEME).toBe("mono");
    const mono = THEMES.find((t) => t.id === "mono");
    expect(mono?.colors.accent).toBe("#f4f4f5");
    expect(mono?.colors.bg).toBe("#0a0a0b");
  });

  test("ids are unique and every preset defines the same variables", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    const keys = Object.keys((THEMES[0] as (typeof THEMES)[number]).colors).sort();
    for (const t of THEMES) expect(Object.keys(t.colors).sort()).toEqual(keys);
  });

  test("css puts the default on :root and each preset on html[data-theme]", () => {
    const css = themeCss();
    expect(css.startsWith(":root { color-scheme: dark; --bg: #0a0a0b;")).toBe(true);
    for (const t of THEMES) expect(css).toContain(`html[data-theme="${t.id}"] { color-scheme: ${t.scheme};`);
  });
});
