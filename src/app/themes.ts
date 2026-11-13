// Preset colour themes. page.ts renders every preset into CSS custom
// properties keyed by `html[data-theme]`; the first preset is the default.

export interface Theme {
  id: string;
  name: string;
  scheme: "dark" | "light";
  colors: {
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
  };
}

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
];

export const DEFAULT_THEME = (THEMES[0] as Theme).id;
export const THEME_KEY = "valet-ui.theme";

const block = (t: Theme): string =>
  `color-scheme: ${t.scheme}; ${Object.entries(t.colors)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ")}`;

/** `:root` carries the default so an unknown stored id still renders. */
export function themeCss(): string {
  return [
    `:root { ${block(THEMES[0] as Theme)} }`,
    ...THEMES.map((t) => `html[data-theme="${t.id}"] { ${block(t)} }`),
  ].join("\n");
}

/** Inline head script: applies the stored theme before first paint. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export function currentTheme(): string {
  const id = document.documentElement.dataset.theme;
  return THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_THEME;
}

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // private mode; the choice lasts until reload
  }
}
