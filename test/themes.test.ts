import { describe, expect, test } from "bun:test";
import {
  cleanFontStack,
  cleanTheme,
  COLOR_RE,
  DEFAULT_THEME,
  deriveColors,
  THEMES,
  themeCss,
} from "../src/app/themes";

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

describe("theme palette", () => {
  test("ships a good spread of presets, light and dark", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(18);
    expect(THEMES.filter((t) => t.scheme === "light").length).toBeGreaterThanOrEqual(5);
  });

  test("every colour is a plain hex or rgba value", () => {
    for (const t of THEMES) for (const v of Object.values(t.colors)) expect(COLOR_RE.test(v)).toBe(true);
  });

  test("derived colours keep the three given ones and stay hex", () => {
    const c = deriveColors({ bg: "#101820", text: "#f0f0f0", accent: "#ffcc00" }, "dark");
    expect([c.bg, c.text, c.accent]).toEqual(["#101820", "#f0f0f0", "#ffcc00"]);
    expect(c["on-accent"]).toBe("#0a0a0b");
    expect(c.panel).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("theme css carries fonts, with Public Sans features only for Public Sans", () => {
    const css = themeCss();
    expect(css).toContain("--font: ");
    expect(css).toContain('html[data-theme="terminal"]');
    expect(css).toMatch(/html\[data-theme="mono"\][^}]*--font-features: "cv11", "ss03"/);
    expect(css).toMatch(/html\[data-theme="terminal"\][^}]*--font-features: normal/);
  });
});

describe("custom themes", () => {
  const good = {
    id: "my-one",
    name: "One",
    scheme: "dark",
    colors: (THEMES[0] as (typeof THEMES)[number]).colors,
    fonts: { sans: 'Inter, "Helvetica Neue"', mono: "Fira Code" },
  };

  test("a valid theme is accepted and marked custom", () => {
    const t = cleanTheme(good);
    expect(t?.custom).toBe(true);
    expect(t?.fonts?.sans).toBe('Inter, "Helvetica Neue"');
  });

  test("ids that collide with a preset or break a selector are refused", () => {
    expect(cleanTheme({ ...good, id: "mono" })).toBeNull();
    expect(cleanTheme({ ...good, id: 'x"] { } a[b="' })).toBeNull();
  });

  test("css cannot be smuggled through colours or fonts", () => {
    const bad = { ...good.colors, accent: "red; } body { display: none" };
    expect(cleanTheme({ ...good, colors: bad })).toBeNull();
    expect(cleanFontStack("Inter; } body { x: y")).toBeNull();
    expect(cleanFontStack('"Unclosed, serif')).toBeNull();
    expect(cleanFontStack("url(http://evil)")).toBeNull();
    expect(cleanFontStack("Inter,  Menlo")).toBe("Inter, Menlo");
  });

  test("a missing colour is refused", () => {
    const { bg: _bg, ...rest } = good.colors;
    expect(cleanTheme({ ...good, colors: rest })).toBeNull();
  });

  test("custom themes render under their own selector", () => {
    const t = cleanTheme(good) as (typeof THEMES)[number];
    expect(themeCss([t])).toContain('html[data-theme="my-one"] { color-scheme: dark;');
  });
});

describe("brand presets", () => {
  test("Tokyo Night is a dark preset", () => {
    const t = THEMES.find((x) => x.id === "tokyo-night");
    expect(t?.scheme).toBe("dark");
    expect(t?.colors.bg).toBe("#1a1b26");
  });

  test("Absolutely! uses the brand colours and a heading font", () => {
    const t = THEMES.find((x) => x.id === "absolutely");
    expect(t?.name).toBe("Absolutely!");
    expect([t?.colors.bg, t?.colors.text, t?.colors.accent]).toEqual(["#faf9f5", "#141413", "#d97757"]);
    expect(t?.fonts?.heading).toStartWith("Poppins");
    expect(t?.fonts?.sans).toStartWith("Lora");
    expect(themeCss()).toMatch(/html\[data-theme="absolutely"\][^}]*--font-head: Poppins/);
  });
});

describe("pitch black", () => {
  test("the base surfaces are pure black", () => {
    const c = THEMES.find((x) => x.id === "pitch-black")?.colors;
    expect([c?.bg, c?.panel, c?.surface, c?.code]).toEqual(["#000000", "#000000", "#000000", "#000000"]);
  });
});
