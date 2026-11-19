import { describe, expect, test } from "bun:test";
import type { CorePluginSettings, SettingsEntry } from "../src/app/types";
import {
  buildSettingsPages,
  deriveGroup,
  groupPages,
  groupSubtitle,
  propertiesForPage,
} from "../src/app/views/settings-pages";

describe("deriveGroup", () => {
  test("honors x-group, else inference → providers, tools-only → tools", () => {
    expect(deriveGroup([], { "x-group": "inference" })).toBe("inference");
    expect(deriveGroup(["inference@1"])).toBe("inference");
    expect(deriveGroup(["tools@1"])).toBe("tools");
    expect(deriveGroup(["tools@1", "settings@1"])).toBe("tools");
    expect(deriveGroup(["context@1", "tools@1"])).toBe("system");
    expect(deriveGroup([])).toBe("system");
  });
});

describe("propertiesForPage", () => {
  const schema = {
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "string", "x-page": "models" },
      c: { type: "boolean", "x-page": "models" },
    },
  };

  test("main page skips x-page fields; named page keeps only its own", () => {
    expect(Object.keys(propertiesForPage(schema, null))).toEqual(["a"]);
    expect(Object.keys(propertiesForPage(schema, "models"))).toEqual(["b", "c"]);
    expect(Object.keys(propertiesForPage(schema, "other"))).toEqual([]);
  });
});

describe("buildSettingsPages", () => {
  const agent: CorePluginSettings = {
    plugin: "valet-agent",
    name: "Agent",
    provides: ["context@1"],
    state: "active",
    enabled: true,
    schema: {
      type: "object",
      "x-group": "system",
      "x-order": 0,
      "x-pages": {
        models: { title: "Models", group: "inference", order: 900 },
      },
      properties: {
        queueMode: { type: "string", enum: ["queue", "interrupt"] },
        models: { type: "array", "x-widget": "models", "x-page": "models" },
        defaultModel: { type: "object", "x-widget": "model", "x-page": "models" },
      },
    },
    values: { queueMode: "queue", models: [] },
    sources: { queueMode: "default" },
  };

  const provider: CorePluginSettings = {
    plugin: "valet-modelapi",
    name: "Model API",
    provides: ["inference@1"],
    state: "active",
    enabled: true,
    schema: {
      type: "object",
      "x-group": "inference",
      "x-order": 20,
      properties: { endpoints: { type: "array" } },
    },
    values: { endpoints: [] },
    sources: {},
  };

  test("splits x-pages and attaches panels by plugin / page", () => {
    const panels: SettingsEntry[] = [
      { key: "usage", plugin: "valet-agent", title: "Usage", blocks: [] },
      {
        key: "models-extra",
        plugin: "valet-agent",
        title: "Extra",
        page: "models",
        blocks: [],
      },
    ];
    const pages = buildSettingsPages([agent, provider], panels);
    expect(pages.map((p) => p.id).sort()).toEqual(["valet-agent", "valet-agent:models", "valet-modelapi"]);
    const main = pages.find((p) => p.id === "valet-agent");
    const models = pages.find((p) => p.id === "valet-agent:models");
    expect(main?.fieldKeys).toEqual(["queueMode"]);
    expect(main?.panels.map((p) => p.key)).toEqual(["usage"]);
    expect(models?.group).toBe("inference");
    expect(models?.fieldKeys.sort()).toEqual(["defaultModel", "models"]);
    expect(models?.panels.map((p) => p.key)).toEqual(["models-extra"]);
    expect(pages.find((p) => p.id === "valet-modelapi")?.group).toBe("inference");
  });

  test("groupPages sorts by group order then page order", () => {
    const pages = buildSettingsPages([agent, provider], []);
    const grouped = groupPages(pages);
    expect(grouped.map((g) => g.group)).toEqual(["system", "inference"]);
    expect(grouped[1]?.pages.map((p) => p.title)).toEqual(["Model API", "Models"]);
  });

  test("panel-only plugin gets a synthetic system page", () => {
    const pages = buildSettingsPages(
      [],
      [{ key: "pwd", plugin: "valet-auth", pluginName: "Auth", title: "Password" }],
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.id).toBe("valet-auth");
    expect(pages[0]?.panels[0]?.key).toBe("pwd");
  });
});

describe("groupSubtitle", () => {
  test("joins up to three titles, then ellipsizes", () => {
    expect(groupSubtitle([])).toBe("");
    expect(groupSubtitle(["Agent"])).toBe("Agent");
    expect(groupSubtitle(["Claude Code", "Codex", "Cursor"])).toBe("Claude Code, Codex, Cursor");
    expect(groupSubtitle(["Claude Code", "Codex", "Cursor", "Devin"])).toBe("Claude Code, Codex, Cursor…");
  });

  test("drops blank titles", () => {
    expect(groupSubtitle(["  ", "Agent", ""])).toBe("Agent");
  });
});
