// Colour + font themes. page.ts renders every preset into CSS custom
// properties keyed by `html[data-theme]`; the first preset is the default.
// Users can also make their own (kept in localStorage, see `saveCustom`).

export interface ThemeColors {
  bg: string;
  panel: string;
  surface: string;
  raised: string;
  border: string;
  strong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  "on-accent": string;
  user: string;
  code: string;
  danger: string;
  warn: string;
  ok: string;
  shadow: string;
}

export interface ThemeFonts {
  sans: string;
  mono: string;
}

export interface Theme {
  id: string;
  name: string;
  scheme: "dark" | "light";
  colors: ThemeColors;
  fonts?: ThemeFonts;
  custom?: boolean;
}

export interface FontChoice {
  name: string;
  stack: string;
}

// Only Public Sans is bundled; the rest resolve to fonts installed on the device.
export const SANS_FONTS: FontChoice[] = [
  {
    name: "Public Sans",
    stack: '"Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto',
  },
  { name: "System", stack: 'system-ui, -apple-system, "Segoe UI", Roboto' },
  { name: "Humanist", stack: 'Seravek, "Gill Sans Nova", "Gill Sans", Calibri, Candara, "Trebuchet MS"' },
  { name: "Geometric", stack: '"Avenir Next", Avenir, Montserrat, "Century Gothic", Futura' },
  { name: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", Nunito, "Hiragino Maru Gothic ProN", Quicksand' },
  { name: "Serif", stack: 'Charter, "Bitstream Charter", "Iowan Old Style", "Palatino Linotype", Georgia' },
  { name: "Mono", stack: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas' },
];

export const MONO_FONTS: FontChoice[] = [
  { name: "System mono", stack: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas' },
  { name: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas' },
  { name: "Fira Code", stack: '"Fira Code", "Fira Mono", ui-monospace, Menlo, Consolas' },
  { name: "Cascadia Code", stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, Consolas' },
  { name: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, Menlo, Consolas' },
  { name: "Courier", stack: '"Courier New", Courier' },
];

const SANS = (SANS_FONTS[0] as FontChoice).stack;
const MONO = (MONO_FONTS[0] as FontChoice).stack;
export const DEFAULT_FONTS: ThemeFonts = { sans: SANS, mono: MONO };

const hex = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

function rgb(c: string): [number, number, number] {
  const h = c.length === 4 ? c.replace(/[0-9a-f]/gi, "$&$&").slice(1) : c.slice(1, 7);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Blends `a` towards `b` by `t` (0..1). Both are `#rgb` / `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${[0, 1, 2].map((i) => hex((x[i] as number) * (1 - t) + (y[i] as number) * t)).join("")}`;
}

const luminance = (c: string): number => {
  const [r, g, b] = rgb(c).map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The remaining variables of a theme, worked out from its three main colours. */
export function deriveColors(
  base: { bg: string; text: string; accent: string },
  scheme: "dark" | "light",
): ThemeColors {
  const { bg, text, accent } = base;
  const dark = scheme === "dark";
  const toward = (t: number): string => mix(bg, text, t);
  return {
    bg,
    panel: toward(dark ? 0.04 : 0.03),
    surface: dark ? toward(0.06) : "#ffffff",
    raised: toward(dark ? 0.1 : 0.07),
    border: toward(dark ? 0.14 : 0.12),
    strong: toward(dark ? 0.26 : 0.25),
    text,
    muted: mix(text, bg, 0.35),
    faint: mix(text, bg, 0.6),
    accent,
    "on-accent": luminance(accent) > 0.45 ? "#0a0a0b" : "#ffffff",
    user: mix(bg, accent, dark ? 0.2 : 0.14),
    code: dark ? mix(bg, "#000000", 0.35) : toward(0.04),
    danger: dark ? "#f87171" : "#dc2626",
    warn: dark ? "#fbbf24" : "#b45309",
    ok: dark ? "#4ade80" : "#16a34a",
    shadow: dark ? "rgba(0, 0, 0, 0.5)" : "rgba(15, 15, 20, 0.08)",
  };
}

const derived = (
  id: string,
  name: string,
  scheme: "dark" | "light",
  base: { bg: string; text: string; accent: string },
  over: Partial<ThemeColors> = {},
  fonts?: ThemeFonts,
): Theme => ({
  id,
  name,
  scheme,
  colors: { ...deriveColors(base, scheme), ...over },
  ...(fonts === undefined ? {} : { fonts }),
});

export const THEMES: Theme[] = [
  {
    id: "mono",
    name: "Mono",
    scheme: "dark",
    colors: {
      bg: "#0a0a0b",
      panel: "#121214",
      surface: "#161617",
      raised: "#1f1f21",
      border: "#262628",
      strong: "#3a3a3d",
      text: "#ededee",
      muted: "#a0a0a6",
      faint: "#68686e",
      accent: "#f4f4f5",
      "on-accent": "#0a0a0b",
      user: "#222224",
      code: "#0f0f10",
      danger: "#f87171",
      warn: "#fbbf24",
      ok: "#4ade80",
      shadow: "rgba(0, 0, 0, 0.55)",
    },
  },
  {
    id: "paper",
    name: "Paper",
    scheme: "light",
    colors: {
      bg: "#ffffff",
      panel: "#f6f6f7",
      surface: "#ffffff",
      raised: "#efeff1",
      border: "#e4e4e7",
      strong: "#cfcfd4",
      text: "#0a0a0b",
      muted: "#5b5b63",
      faint: "#9a9aa2",
      accent: "#0a0a0b",
      "on-accent": "#fafafa",
      user: "#f0f0f2",
      code: "#f6f6f7",
      danger: "#dc2626",
      warn: "#b45309",
      ok: "#16a34a",
      shadow: "rgba(15, 15, 20, 0.08)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    scheme: "dark",
    colors: {
      bg: "#0d1117",
      panel: "#121821",
      surface: "#151b24",
      raised: "#1d2531",
      border: "#242d3a",
      strong: "#344050",
      text: "#d8dee9",
      muted: "#9aa5b4",
      faint: "#5f6b7a",
      accent: "#7aa2f7",
      "on-accent": "#0a0e14",
      user: "#1f3050",
      code: "#0a0e14",
      danger: "#f7768e",
      warn: "#e0af68",
      ok: "#9ece6a",
      shadow: "rgba(0, 0, 0, 0.5)",
    },
  },
  {
    id: "moss",
    name: "Moss",
    scheme: "dark",
    colors: {
      bg: "#0e110f",
      panel: "#131815",
      surface: "#151a16",
      raised: "#1d241f",
      border: "#252e27",
      strong: "#364238",
      text: "#dfe6df",
      muted: "#9cab9f",
      faint: "#627066",
      accent: "#8fd19e",
      "on-accent": "#0b0d0c",
      user: "#1e3324",
      code: "#0b0d0c",
      danger: "#f28b82",
      warn: "#e6c07b",
      ok: "#8fd19e",
      shadow: "rgba(0, 0, 0, 0.5)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    scheme: "dark",
    colors: {
      bg: "#12100e",
      panel: "#181513",
      surface: "#1a1715",
      raised: "#24201c",
      border: "#2e2924",
      strong: "#433b33",
      text: "#ede6de",
      muted: "#ada296",
      faint: "#74695e",
      accent: "#f0a46c",
      "on-accent": "#12100e",
      user: "#3a2a1e",
      code: "#0e0c0b",
      danger: "#f28b82",
      warn: "#f0c674",
      ok: "#a8cc8c",
      shadow: "rgba(0, 0, 0, 0.5)",
    },
  },
  {
    id: "sand",
    name: "Sand",
    scheme: "light",
    colors: {
      bg: "#faf8f5",
      panel: "#f2eee8",
      surface: "#ffffff",
      raised: "#ebe5dc",
      border: "#e3dcd1",
      strong: "#cfc5b6",
      text: "#1f1b16",
      muted: "#6b6157",
      faint: "#a3988b",
      accent: "#c2410c",
      "on-accent": "#ffffff",
      user: "#efe7dc",
      code: "#f2eee8",
      danger: "#b91c1c",
      warn: "#a16207",
      ok: "#15803d",
      shadow: "rgba(60, 40, 20, 0.08)",
    },
  },
  derived(
    "midnight",
    "Midnight",
    "dark",
    { bg: "#000000", text: "#e8e8ea", accent: "#c4b5fd" },
    { panel: "#0a0a0c", surface: "#0d0d0f", raised: "#161618" },
  ),
  derived(
    "nord",
    "Nord",
    "dark",
    { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0" },
    {
      panel: "#333a47",
      surface: "#3b4252",
      raised: "#434c5e",
      border: "#4c566a",
      danger: "#bf616a",
      warn: "#ebcb8b",
      ok: "#a3be8c",
    },
  ),
  derived(
    "dracula",
    "Dracula",
    "dark",
    { bg: "#282a36", text: "#f8f8f2", accent: "#bd93f9" },
    {
      panel: "#21222c",
      surface: "#2b2d3a",
      raised: "#343746",
      border: "#44475a",
      muted: "#b6b9cf",
      faint: "#6272a4",
      danger: "#ff5555",
      warn: "#f1fa8c",
      ok: "#50fa7b",
    },
  ),
  derived(
    "rose-pine",
    "Rosé Pine",
    "dark",
    { bg: "#191724", text: "#e0def4", accent: "#ebbcba" },
    {
      panel: "#1f1d2e",
      surface: "#1f1d2e",
      raised: "#26233a",
      border: "#2a2740",
      strong: "#403d52",
      muted: "#908caa",
      faint: "#6e6a86",
      danger: "#eb6f92",
      warn: "#f6c177",
      ok: "#9ccfd8",
    },
  ),
  derived(
    "mocha",
    "Mocha",
    "dark",
    { bg: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7" },
    {
      panel: "#181825",
      surface: "#232334",
      raised: "#313244",
      border: "#363749",
      strong: "#45475a",
      muted: "#a6adc8",
      faint: "#6c7086",
      danger: "#f38ba8",
      warn: "#f9e2af",
      ok: "#a6e3a1",
    },
  ),
  derived(
    "gruvbox",
    "Gruvbox",
    "dark",
    { bg: "#282828", text: "#ebdbb2", accent: "#fabd2f" },
    {
      panel: "#32302f",
      surface: "#32302f",
      raised: "#3c3836",
      border: "#45403d",
      strong: "#665c54",
      muted: "#bdae93",
      faint: "#7c6f64",
      danger: "#fb4934",
      warn: "#fe8019",
      ok: "#b8bb26",
    },
  ),
  derived(
    "solarized-dark",
    "Solarized Dark",
    "dark",
    { bg: "#002b36", text: "#93a1a1", accent: "#2aa198" },
    {
      panel: "#00252f",
      surface: "#073642",
      raised: "#0b3d4a",
      border: "#124650",
      strong: "#2a5b66",
      muted: "#839496",
      faint: "#586e75",
      danger: "#dc322f",
      warn: "#b58900",
      ok: "#859900",
    },
  ),
  derived(
    "terminal",
    "Terminal",
    "dark",
    { bg: "#050805", text: "#b6f5b6", accent: "#3dff7a" },
    {
      panel: "#0a0f0a",
      surface: "#0b110b",
      raised: "#122012",
      border: "#17301a",
      strong: "#24512a",
      muted: "#7fbf7f",
      faint: "#487048",
      user: "#0f2a14",
      code: "#030503",
    },
    { sans: MONO, mono: MONO },
  ),
  derived(
    "latte",
    "Latte",
    "light",
    { bg: "#eff1f5", text: "#4c4f69", accent: "#8839ef" },
    {
      panel: "#e6e9ef",
      surface: "#fbfbfd",
      raised: "#dce0e8",
      border: "#ccd0da",
      strong: "#acb0be",
      muted: "#6c6f85",
      faint: "#9ca0b0",
      danger: "#d20f39",
      warn: "#df8e1d",
      ok: "#40a02b",
    },
  ),
  derived(
    "solarized-light",
    "Solarized Light",
    "light",
    { bg: "#fdf6e3", text: "#586e75", accent: "#268bd2" },
    {
      panel: "#f5eed9",
      surface: "#fffbed",
      raised: "#eee8d5",
      border: "#e6dfc8",
      strong: "#d3cbb0",
      muted: "#657b83",
      faint: "#93a1a1",
      danger: "#dc322f",
      warn: "#b58900",
      ok: "#859900",
    },
  ),
  derived(
    "gruvbox-light",
    "Gruvbox Light",
    "light",
    { bg: "#fbf1c7", text: "#3c3836", accent: "#af3a03" },
    {
      panel: "#f2e5bc",
      surface: "#fdf6d6",
      raised: "#ebdbb2",
      border: "#e0d0a0",
      strong: "#d5c4a1",
      muted: "#665c54",
      faint: "#928374",
      danger: "#9d0006",
      warn: "#b57614",
      ok: "#79740e",
    },
  ),
  derived(
    "parchment",
    "Parchment",
    "light",
    { bg: "#f7f1e3", text: "#2b2118", accent: "#7a3b1e" },
    {
      panel: "#efe7d4",
      surface: "#fbf7ec",
      raised: "#e8dec6",
      border: "#ddd1b6",
      strong: "#c9b994",
      muted: "#65564a",
      faint: "#9a8a76",
      "on-accent": "#fbf7ec",
    },
    { sans: (SANS_FONTS[5] as FontChoice).stack, mono: MONO },
  ),
  derived(
    "blossom",
    "Blossom",
    "light",
    { bg: "#fff7f8", text: "#3a2230", accent: "#d6336c" },
    {
      panel: "#fdeef1",
      surface: "#ffffff",
      raised: "#f9e0e6",
      border: "#f2d3db",
      strong: "#e4b8c4",
      muted: "#7a5568",
      faint: "#b0909f",
      "on-accent": "#ffffff",
    },
  ),
];

export const DEFAULT_THEME = (THEMES[0] as Theme).id;
export const THEME_KEY = "valet-ui.theme";
export const CUSTOM_KEY = "valet-ui.custom-themes";
export const CUSTOM_CSS_KEY = "valet-ui.custom-css";
const STYLE_ID = "custom-themes";

export const COLOR_RE = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]{3,40}\))$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FONT_ITEM_RE = /^(?:"[\w .-]+"|'[\w .-]+'|[\w .-]+)$/;

/** Accepts a comma separated font stack of plain family names only, so it is
 * safe to put in a stylesheet. Returns the tidied stack or null. */
export function cleanFontStack(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const items = raw.split(",").map((i) => i.trim());
  if (items.length > 12 || !items.every((i) => i.length > 0 && FONT_ITEM_RE.test(i))) return null;
  return items.join(", ");
}

const KEYS = Object.keys((THEMES[0] as Theme).colors) as (keyof ThemeColors)[];

/** Validates an untrusted theme (storage, import). Returns null if unusable. */
export function cleanTheme(raw: unknown): Theme | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_RE.test(r.id) || THEMES.some((t) => t.id === r.id)) return null;
  if (typeof r.name !== "string" || r.name.trim() === "") return null;
  if (r.scheme !== "dark" && r.scheme !== "light") return null;
  const src = r.colors as Record<string, unknown> | null;
  if (typeof src !== "object" || src === null) return null;
  const colors = {} as ThemeColors;
  for (const k of KEYS) {
    const v = src[k];
    if (typeof v !== "string" || !COLOR_RE.test(v)) return null;
    colors[k] = v;
  }
  const theme: Theme = { id: r.id, name: r.name.trim().slice(0, 40), scheme: r.scheme, colors, custom: true };
  if (r.fonts !== undefined) {
    const f = r.fonts as Record<string, unknown> | null;
    const sans = cleanFontStack(f?.sans);
    const mono = cleanFontStack(f?.mono);
    if (sans === null || mono === null) return null;
    theme.fonts = { sans, mono };
  }
  return theme;
}

const sansFeatures = (sans: string): string =>
  sans.startsWith('"Public Sans"') ? '"cv11", "ss03"' : "normal";

const block = (t: Theme): string => {
  const f = t.fonts ?? DEFAULT_FONTS;
  return `color-scheme: ${t.scheme}; ${Object.entries(t.colors)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(
      " ",
    )} --font: ${f.sans}, sans-serif; --mono: ${f.mono}, monospace; --font-features: ${sansFeatures(f.sans)};`;
};

/** `:root` carries the default so an unknown stored id still renders. */
export function themeCss(list: Theme[] = THEMES): string {
  return [
    `:root { ${block(THEMES[0] as Theme)} }`,
    ...list.map((t) => `html[data-theme="${t.id}"] { ${block(t)} }`),
  ].join("\n");
}

/** Inline head script: applies the stored theme before first paint. */
export const themeBootScript = `try{var c=localStorage.getItem(${JSON.stringify(CUSTOM_CSS_KEY)});if(c){var s=document.createElement("style");s.id=${JSON.stringify(STYLE_ID)};s.textContent=c;document.head.appendChild(s)}var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t)document.documentElement.dataset.theme=t}catch(e){}`;

let custom: Theme[] | null = null;

export function customThemes(): Theme[] {
  if (custom !== null) return custom;
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
  } catch {
    parsed = [];
  }
  const seen = new Set<string>();
  custom = (Array.isArray(parsed) ? parsed : []).flatMap((raw) => {
    const t = cleanTheme(raw);
    if (t === null || seen.has(t.id)) return [];
    seen.add(t.id);
    return [t];
  });
  return custom;
}

export const allThemes = (): Theme[] => [...THEMES, ...customThemes()];

/** Persists the custom themes and (re)writes the stylesheet that renders them. */
export function saveCustom(list: Theme[]): void {
  custom = list;
  const css = themeCss(list).split("\n").slice(1).join("\n");
  let style = document.getElementById(STYLE_ID);
  if (style === null) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = css;
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    localStorage.setItem(CUSTOM_CSS_KEY, css);
  } catch {
    // private mode; the themes last until reload
  }
}

/** Re-renders stored themes through the validator, so what the head script
 * injected from storage is replaced by checked output. */
export function syncCustom(): void {
  saveCustom(customThemes());
}

export function freshId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "theme";
  const taken = new Set(allThemes().map((t) => t.id));
  let id = `my-${base}`;
  for (let n = 2; taken.has(id); n++) id = `my-${base}-${n}`;
  return id;
}

/** A custom copy of `t`, ready to edit. */
export function copyTheme(t: Theme, name: string): Theme {
  const copy: Theme = { id: freshId(name), name, scheme: t.scheme, colors: { ...t.colors }, custom: true };
  if (t.fonts !== undefined) copy.fonts = { ...t.fonts };
  return copy;
}

export function exportTheme(t: Theme): string {
  return JSON.stringify(
    { name: t.name, scheme: t.scheme, colors: t.colors, ...(t.fonts ? { fonts: t.fonts } : {}) },
    null,
    2,
  );
}

/** Parses an exported theme; it gets a fresh id so it can never replace one. */
export function importTheme(text: string): Theme | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const name = String((raw as { name?: unknown }).name ?? "Imported").slice(0, 40) || "Imported";
  return cleanTheme({ ...raw, id: freshId(name), name });
}

export function currentTheme(): string {
  const id = document.documentElement.dataset.theme;
  return allThemes().some((t) => t.id === id) ? (id as string) : DEFAULT_THEME;
}

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // private mode; the choice lasts until reload
  }
}
