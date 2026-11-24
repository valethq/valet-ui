import { describe, expect, test } from "bun:test";
import { formatTokens, mergeModelRows, parseTokens, rowFor, tokensInput } from "../src/app/model-rows";

const providers = [
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      {
        id: "gpt-5",
        name: "Renamed",
        show: false,
        contextWindow: 200_000,
        base: { id: "gpt-5", name: "GPT-5", contextWindow: 200_000 },
      },
      {
        id: "o3",
        name: "o3",
        show: true,
        efforts: ["low", "high"],
        base: { id: "o3", name: "o3", efforts: ["low", "high"] },
      },
      { id: "local-llama", name: "Llama", show: true, custom: true, contextWindow: 128_000 },
    ],
  },
];

const saved = [
  { provider: "openai", id: "gpt-5", show: false, name: "Renamed" },
  { provider: "openai", id: "local-llama", custom: true, name: "Llama" },
  { provider: "openai", id: "*", show: true },
  { provider: "gone", id: "old", name: "Kept" },
];

describe("mergeModelRows", () => {
  test("lists catalog models with provider values and keeps rows it doesn't show", () => {
    const { entries, kept } = mergeModelRows(providers, saved);
    expect(entries.map((e) => e.id)).toEqual(["gpt-5", "o3", "local-llama"]);
    expect(entries[0]?.base?.name).toBe("GPT-5");
    expect(entries[0]?.fields.name).toBe("Renamed");
    expect(entries[2]?.custom).toBe(true);
    expect(entries[2]?.base).toBeUndefined();
    expect(kept.map((r) => r.id)).toEqual(["*", "old"]);
  });
});

describe("rowFor", () => {
  const { entries } = mergeModelRows(providers, saved);
  test("saves only what differs from the provider", () => {
    expect(entries.map(rowFor)).toEqual([
      { provider: "openai", id: "gpt-5", show: false, name: "Renamed" },
      undefined,
      { provider: "openai", id: "local-llama", name: "Llama", contextWindow: 128_000, custom: true },
    ]);
  });
  test("drops an override set back to the provider's value", () => {
    const [gpt] = entries;
    if (gpt === undefined) throw new Error("missing");
    expect(rowFor({ ...gpt, show: true, fields: { ...gpt.fields, name: "GPT-5" } })).toBeUndefined();
  });
});

describe("tokens", () => {
  test("formats and parses", () => {
    expect([1_000_000, 272_000, 131_072, 1_500_000, 900].map(formatTokens)).toEqual([
      "1M",
      "272K",
      "131K",
      "1.5M",
      "900",
    ]);
    expect(tokensInput(131_072)).toBe("131072");
    expect(["272K", "1m", "1.5M", "200,000"].map(parseTokens)).toEqual([
      272_000, 1_000_000, 1_500_000, 200_000,
    ]);
    expect(() => parseTokens("abc")).toThrow();
    expect(() => parseTokens("1.0001K")).toThrow();
  });
});
