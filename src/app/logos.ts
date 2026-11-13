import { el } from "./dom";
import claude from "./logos/claude.svg" with { type: "text" };
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
  | "devin";

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
};

// First hit wins: open-weight labs come first so distills like
// "DeepSeek R1 Distill Llama" or "Qwen3 Coder" keep their own mark.
const RULES: [RegExp, LogoId][] = [
  [/\bswe\b|devin|cognition/i, "devin"],
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

export function logoMark(id: LogoId): HTMLSpanElement {
  const { svg, mono } = LOGOS[id];
  return el("span", {
    class: `logo${mono ? " mono" : ""}`,
    "data-logo": id,
    "aria-hidden": "true",
    style: `--logo: url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
  });
}
