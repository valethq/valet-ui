import { describe, expect, test } from "bun:test";
import { familyOf, groupModels } from "../src/app/models";
import type { ProviderModels } from "../src/app/types";

describe("familyOf", () => {
  test("strips a trailing effort suffix", () => {
    expect(familyOf("claude-opus-5.5-high")).toEqual({
      family: "claude-opus-5.5",
      effort: "high",
    });
    expect(familyOf("gpt-6-codex-xhigh")).toEqual({ family: "gpt-6-codex", effort: "xhigh" });
    expect(familyOf("foo-none")).toEqual({ family: "foo", effort: "none" });
  });

  test("keeps ids without a suffix whole", () => {
    expect(familyOf("claude-opus-5.5")).toEqual({
      family: "claude-opus-5.5",
      effort: "default",
    });
    expect(familyOf("model-fast")).toEqual({ family: "model-fast", effort: "default" });
    expect(familyOf("highlander")).toEqual({ family: "highlander", effort: "default" });
  });
});

const providers: ProviderModels[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-opus-5.5-high", name: "Claude Opus 5.5 High" },
      { id: "claude-opus-5.5-max", name: "Claude Opus 5.5 Max" },
      { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-low", name: "Claude Sonnet 5 (low)" },
      { id: "fusion-claude-gpt", name: "Fusion Claude GPT" },
      { id: "sidekick-1", name: "Sidekick" },
      { id: "claude-haiku-fast", name: "Claude Haiku Fast" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-6-medium", name: "GPT-6 Medium" },
      { id: "gpt-6-high", name: "GPT-6 High" },
    ],
  },
];

describe("groupModels", () => {
  const families = groupModels(providers);

  test("collapses variants into one family per key, in provider order", () => {
    expect(families.map((f) => f.key)).toEqual([
      "claude-opus-5.5",
      "claude-sonnet-5",
      "fusion-claude-gpt",
      "sidekick-1",
      "claude-haiku-fast",
      "gpt-6",
    ]);
    const opus = families[0];
    expect(opus?.provider).toBe("anthropic");
    expect(opus?.variants.map((v) => v.effort)).toEqual(["high", "max", "default"]);
    expect(opus?.variants.map((v) => v.id)).toEqual([
      "claude-opus-5.5-high",
      "claude-opus-5.5-max",
      "claude-opus-5.5",
    ]);
  });

  test("labels come from the first variant's name minus the effort word", () => {
    expect(families[0]?.label).toBe("Claude Opus 5.5");
    expect(families[1]?.label).toBe("Claude Sonnet 5");
    expect(families[5]?.label).toBe("GPT-6");
    expect(families[5]?.providerLabel).toBe("OpenAI");
  });

  test("fusion-, sidekick and -fast/-priority/-lightning keys are 'more'", () => {
    expect(families[0]?.more).toBe(false);
    expect(families[1]?.more).toBe(false);
    expect(families[2]?.more).toBe(true);
    expect(families[3]?.more).toBe(true);
    expect(families[4]?.more).toBe(true);
    expect(families[5]?.more).toBe(false);
  });

  test("same family key under different providers stays separate", () => {
    const two: ProviderModels[] = [
      { provider: "a", label: "A", models: [{ id: "m-high", name: "M High" }] },
      { provider: "b", label: "B", models: [{ id: "m-low", name: "M Low" }] },
    ];
    const fs = groupModels(two);
    expect(fs).toHaveLength(2);
    expect(fs[0]?.provider).toBe("a");
    expect(fs[1]?.provider).toBe("b");
  });
});

describe("provider icons", () => {
  test("each family carries its provider's logo key, when there is one", () => {
    const fams = groupModels([
      {
        provider: "cursor",
        label: "Cursor",
        icon: "cursor",
        models: [{ id: "claude-sonnet-5-high", name: "x" }],
      },
      ...providers,
    ]);
    expect(fams[0]?.providerIcon).toBe("cursor");
    expect(fams.find((f) => f.provider === "openai")?.providerIcon).toBeUndefined();
  });
});
