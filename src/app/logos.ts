import { el } from "./dom";
import claude from "./logos/claude.svg" with { type: "text" };
import cursor from "./logos/cursor.svg" with { type: "text" };
import deepseek from "./logos/deepseek.svg" with { type: "text" };
import devin from "./logos/devin.svg" with { type: "text" };
import gemini from "./logos/gemini.svg" with { type: "text" };
import grok from "./logos/grok.svg" with { type: "text" };
import meta from "./logos/meta.svg" with { type: "text" };
import mistral from "./logos/mistral.svg" with { type: "text" };
import moonshot from "./logos/moonshot.svg" with { type: "text" };
import openai from "./logos/openai.svg" with { type: "text" };
import qwen from "./logos/qwen.svg" with { type: "text" };
import zai from "./logos/zai.svg" with { type: "text" };

export type LogoId =
  | "claude"
  | "openai"
  | "grok"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "qwen"
  | "meta"
  | "zai"
  | "mistral"
  | "devin"
  | "cursor";

/** Black-on-transparent marks render through a mask in the text colour. */
const LOGOS: Record<LogoId, { svg: string; mono: boolean }> = {
  claude: { svg: claude, mono: false },
  openai: { svg: openai, mono: true },
  grok: { svg: grok, mono: true },
  gemini: { svg: gemini, mono: false },
  deepseek: { svg: deepseek, mono: false },
  moonshot: { svg: moonshot, mono: true },
  qwen: { svg: qwen, mono: false },
  meta: { svg: meta, mono: false },
  zai: { svg: zai, mono: true },
  mistral: { svg: mistral, mono: false },
  devin: { svg: devin, mono: true },
  cursor: { svg: cursor, mono: true },
};

// First hit wins: open-weight labs come first so distills like
// "DeepSeek R1 Distill Llama" or "Qwen3 Coder" keep their own mark.
const RULES: [RegExp, LogoId][] = [
  [/\bswe\b|devin|cognition/i, "devin"],
  [/\bcomposer\b|\bcursor\b/i, "cursor"],
  [/deepseek/i, "deepseek"],
  [/qwen|qwq|tongyi|alibaba|dashscope/i, "qwen"],
  [/kimi|moonshot/i, "moonshot"],
  [/glm|zhipu|\bz[.-]?ai\b/i, "zai"],
  [/mistral|mixtral|codestral|devstral|magistral|ministral|pixtral|voxtral/i, "mistral"],
  [/claude|anthropic|\b(opus|sonnet|haiku)\b/i, "claude"],
  [/gpt|openai|codex|davinci|(^|[^a-z0-9])o[1-9](-|\b)/i, "openai"],
  [/grok|\bx-?ai\b/i, "grok"],
  [/gemini|gemma|google|vertex/i, "gemini"],
  [/llama|\bmuse\b|\bmeta\b/i, "meta"],
];

const match = (s: string): LogoId | undefined => RULES.find(([re]) => re.test(s))?.[1];

/** Picks a lab logo from a model's id/display name, falling back to the
 * provider key (`anthropic`, `openai`, ...) when the model itself is opaque. */
export function logoFor(model: string, provider = ""): LogoId | undefined {
  return match(model) ?? match(provider);
}

const isLogo = (key: string): key is LogoId => Object.hasOwn(LOGOS, key);

/** Marks for a model run by a harness whose plugin named `icon` (an inference
 * provider's logo key): model first, then harness. The harness mark only shows
 * when the key is known and differs from the model's; it stands alone when the
 * model has no mark of its own. */
export function logosFor(model: string, provider = "", icon?: string): LogoId[] {
  const own = logoFor(model, provider);
  const harness = icon !== undefined && isLogo(icon) ? icon : undefined;
  if (harness === undefined || harness === own) return own === undefined ? [] : [own];
  return own === undefined ? [harness] : [own, harness];
}

/** One mark, or for [model, harness] a `.logo-pair`: the two side by side,
 * model first. Undefined when there are none. */
export function logoMarks(ids: LogoId[]): HTMLSpanElement | undefined {
  const [first, second] = ids;
  if (first === undefined) return undefined;
  if (second === undefined) return logoMark(first);
  return el("span", { class: "logo-pair" }, logoMark(first), logoMark(second, "harness"));
}

export function logoMark(id: LogoId, extra = ""): HTMLSpanElement {
  const { svg, mono } = LOGOS[id];
  return el("span", {
    class: `logo${mono ? " mono" : ""}${extra === "" ? "" : ` ${extra}`}`,
    "data-logo": id,
    "aria-hidden": "true",
    style: `--logo: url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
  });
}
