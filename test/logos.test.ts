import { describe, expect, test } from "bun:test";
import { logoFor, logosFor } from "../src/app/logos";

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
    ["swe-2-high", "devin"],
    ["SWE-1.5", "devin"],
    ["SWE 1.6 Fast", "devin"],
    ["cognition/swe-grep", "devin"],
    ["Mistral Large", "mistral"],
    ["mistralai/codestral-2508", "mistral"],
    ["Devstral Medium", "mistral"],
    ["Mixtral 8x22B", "mistral"],
    ["Pixtral Large", "mistral"],
    ["GLM-4.6", "zai"],
    ["z-ai/glm-4.5-air", "zai"],
    ["Z.ai GLM 5", "zai"],
    ["Composer 2.5", "cursor"],
    ["cursor/composer-2", "cursor"],
    ["Polo 2", undefined],
    ["Sweetwater 7B", undefined],
  ];
  for (const [name, want] of cases) {
    test(`${name} -> ${want ?? "none"}`, () => expect(logoFor(name)).toBe(want as never));
  }

  test("the provider key is a fallback when the model name is opaque", () => {
    expect(logoFor("fusion-xl", "anthropic")).toBe("claude");
    expect(logoFor("Llama 4", "openai")).toBe("meta");
    expect(logoFor("mystery", "openrouter")).toBeUndefined();
    expect(logoFor("large-2", "zai")).toBe("zai");
    expect(logoFor("high", "devin")).toBe("devin");
  });
});

describe("logosFor", () => {
  test("a harness logo shows only when it is known and differs from the model's", () => {
    expect(logosFor("Claude Sonnet 5", "cursor", "cursor")).toEqual(["cursor", "claude"]);
    expect(logosFor("GPT-6", "cursor", "cursor")).toEqual(["cursor", "openai"]);
    expect(logosFor("Claude Opus 5.5", "claude-code", "claude")).toEqual(["claude"]);
    expect(logosFor("gpt-6-codex", "codex", "openai")).toEqual(["openai"]);
    expect(logosFor("Composer 2.5", "cursor", "cursor")).toEqual(["cursor"]);
    expect(logosFor("GLM 5.3", "opencode", "opencode")).toEqual(["opencode", "zai"]);
    expect(logosFor("big-pickle", "opencode", "opencode")).toEqual(["opencode"]);
  });

  test("without a harness logo only the model's shows, as before", () => {
    expect(logosFor("Claude Sonnet 5", "anthropic")).toEqual(["claude"]);
    expect(logosFor("Claude Sonnet 5", "x", "no-such-logo")).toEqual(["claude"]);
    expect(logosFor("mystery", "openrouter")).toEqual([]);
  });

  test("an opaque model falls back to the harness logo alone", () => {
    expect(logosFor("Auto", "acme", "cursor")).toEqual(["cursor"]);
  });
});
