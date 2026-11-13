import { describe, expect, test } from "bun:test";
import { logoFor } from "../src/app/logos";

describe("logoFor", () => {
  const cases: [string, string | undefined][] = [
    ["Claude Opus 5.5", "claude"],
    ["claude-sonnet-4-5-20250929", "claude"],
    ["Haiku 4.5", "claude"],
    ["GPT-5.1 Codex", "openai"],
    ["gpt-oss-120b", "openai"],
    ["o3-mini", "openai"],
    ["o4", "openai"],
    ["openai/o1-preview", "openai"],
    ["Grok 4 Fast", "grok"],
    ["x-ai/grok-code-fast-1", "grok"],
    ["Gemini 3 Pro", "gemini"],
    ["gemma-3-27b-it", "gemini"],
    ["DeepSeek V3.2", "deepseek"],
    ["deepseek-r1-distill-llama-70b", "deepseek"],
    ["Kimi K2 Thinking", "moonshot"],
    ["moonshotai/kimi-k2", "moonshot"],
    ["Qwen3 Coder 480B", "qwen"],
    ["qwq-32b", "qwen"],
    ["Llama 4 Maverick", "meta"],
    ["Muse Spark", "meta"],
    ["Muse Wonder", "meta"],
    ["meta-llama/llama-3.3-70b-instruct", "meta"],
    ["Mistral Large", "mistral"],
    ["mistralai/codestral-2508", "mistral"],
    ["Devstral Medium", "mistral"],
    ["Mixtral 8x22B", "mistral"],
    ["Pixtral Large", "mistral"],
    ["GLM-4.6", "zai"],
    ["z-ai/glm-4.5-air", "zai"],
    ["Z.ai GLM 5", "zai"],
    ["Polo 2", undefined],
  ];
  for (const [name, want] of cases) {
    test(`${name} -> ${want ?? "none"}`, () => expect(logoFor(name)).toBe(want as never));
  }

  test("the provider key is a fallback when the model name is opaque", () => {
    expect(logoFor("fusion-xl", "anthropic")).toBe("claude");
    expect(logoFor("Llama 4", "openai")).toBe("meta");
    expect(logoFor("mystery", "openrouter")).toBeUndefined();
    expect(logoFor("large-2", "zai")).toBe("zai");
  });
});
