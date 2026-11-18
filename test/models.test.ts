import { describe, expect, test } from "bun:test";
import { groupModels, pickEffort } from "../src/app/models";
import type { ProviderModels } from "../src/app/types";

const providers: ProviderModels[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      {
        id: "claude-opus-5.5",
        name: "Claude Opus 5.5",
        efforts: ["low", "medium", "high", "max"],
        defaultEffort: "high",
        fast: true,
        fastByDefault: false,
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      { id: "fusion-claude-gpt", name: "Fusion Claude GPT", show: false },
      { id: "sidekick-1", name: "Sidekick", hidden: true },
      { id: "", name: "empty id skipped" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      {
        id: "gpt-6",
        name: "GPT-6",
        efforts: ["medium", "high"],
        defaultEffort: "medium",
        fast: true,
        fastByDefault: true,
      },
    ],
  },
];

describe("groupModels", () => {
  const families = groupModels(providers);

  test("one family per model id, in provider order, skipping empty ids", () => {
    expect(families.map((f) => f.key)).toEqual(["claude-opus-5.5", "claude-sonnet-5", "gpt-6"]);
    expect(families[0]?.provider).toBe("anthropic");
    expect(families[0]?.efforts).toEqual(["low", "medium", "high", "max"]);
    expect(families[0]?.defaultEffort).toBe("high");
    expect(families[0]?.fast).toBe(true);
    expect(families[0]?.fastByDefault).toBe(false);
    expect(families[2]?.provider).toBe("openai");
  });

  test("labels come from the catalog name", () => {
    expect(families[0]?.label).toBe("Claude Opus 5.5");
    expect(families[1]?.label).toBe("Claude Sonnet 5");
    expect(families[2]?.label).toBe("GPT-6");
    expect(families[2]?.providerLabel).toBe("OpenAI");
  });

  test("hidden or show:false models are omitted", () => {
    expect(families.map((f) => f.key)).toEqual(["claude-opus-5.5", "claude-sonnet-5", "gpt-6"]);
  });

  test("same id under different providers stays separate", () => {
    const two: ProviderModels[] = [
      { provider: "a", label: "A", models: [{ id: "m", name: "M" }] },
      { provider: "b", label: "B", models: [{ id: "m", name: "M" }] },
    ];
    const fs = groupModels(two);
    expect(fs).toHaveLength(2);
    expect(fs[0]?.provider).toBe("a");
    expect(fs[1]?.provider).toBe("b");
  });
});

test("show:true keeps a provider-hidden model in the picker", () => {
  const fams = groupModels([
    {
      provider: "anthropic",
      label: "Anthropic",
      models: [{ id: "sidekick-1", name: "Sidekick", hidden: true, show: true }],
    },
  ]);
  expect(fams.map((f) => f.key)).toEqual(["sidekick-1"]);
});
describe("pickEffort", () => {
  const f = groupModels(providers)[0];
  if (f === undefined) throw new Error("expected opus family");

  test("keeps a preferred effort when the model lists it", () => {
    expect(pickEffort(f, "low")).toBe("low");
  });

  test("falls back to defaultEffort, then the last effort", () => {
    expect(pickEffort(f, "nope")).toBe("high");
    expect(pickEffort({ ...f, defaultEffort: undefined }, "nope")).toBe("max");
    expect(pickEffort({ ...f, efforts: [], defaultEffort: undefined })).toBeUndefined();
  });
});

describe("provider icons", () => {
  test("each family carries its provider's logo key, when there is one", () => {
    const fams = groupModels([
      {
        provider: "cursor",
        label: "Cursor",
        icon: "cursor",
        models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5" }],
      },
      ...providers,
    ]);
    expect(fams[0]?.providerIcon).toBe("cursor");
    expect(fams.find((f) => f.provider === "openai")?.providerIcon).toBeUndefined();
  });
});
