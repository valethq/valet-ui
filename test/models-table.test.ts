import { describe, expect, test } from "bun:test";
import { mergeModelRows } from "../src/app/views/models-table";

describe("mergeModelRows", () => {
  test("lists catalog models and appends custom saved rows", () => {
    const merged = mergeModelRows(
      [
        {
          provider: "openai",
          label: "OpenAI",
          models: [
            { id: "gpt-5", name: "GPT-5", show: true, contextWindow: 200_000, maxOutputTokens: 16_000 },
            { id: "o3", name: "o3", show: false, efforts: ["low", "high"], fast: true },
          ],
        },
      ],
      [
        { provider: "openai", id: "gpt-5", show: false, name: "Renamed" },
        { provider: "openai", id: "local-llama", custom: true, name: "Llama", show: true },
      ],
    );
    expect(merged.map((r) => r.id)).toEqual(["gpt-5", "o3", "local-llama"]);
    // Catalog already applied overrides; merge keeps catalog view for listed models.
    expect(merged[0]?.name).toBe("GPT-5");
    expect(merged[2]).toMatchObject({ custom: true, id: "local-llama", provider: "openai" });
  });
});
