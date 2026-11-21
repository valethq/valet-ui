import { describe, expect, test } from "bun:test";
import type { ContributionView, CorePluginSettings } from "../src/app/types";
import { buildSettingsPages, groupPages, groupSubtitle } from "../src/app/views/settings-pages";

const agent: CorePluginSettings = {
  plugin: "valet-agent",
  name: "Agent",
  provides: ["settings@2"],
  state: "active",
  enabled: true,
  settings: {
    sections: {
      system: {
        icon: "bot",
        order: 0,
        subsections: [
          { id: "tools", label: "Tools", order: 5, items: [] },
          { id: "chat", label: "Chat", items: [{ id: "queueMode", label: "Q", input: { type: "select" } }] },
        ],
      },
      inference: {
        order: 900,
        subsections: [
          { id: "models", label: "Models", items: [{ id: "models", label: "M", input: { type: "list" } }] },
        ],
      },
    },
  },
  values: { queueMode: "queue" },
  sources: { queueMode: "default" },
};

const raw: CorePluginSettings = {
  plugin: "valet-raw",
  name: "Raw",
  provides: ["tools@1"],
  state: "active",
  enabled: true,
  schema: {
    type: "object",
    properties: {
      n: { type: "integer", title: "N", default: 3 },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  values: { n: 3 },
  sources: { n: "default" },
};

const usage = (plugin: string, section?: "system" | "inference"): ContributionView => ({
  plugin,
  options: [],
  views: [],
  actions: ["refresh"],
  subsections: [{ id: "usage", label: "Usage", items: [], editable: false, ...(section ? { section } : {}) }],
});

describe("buildSettingsPages", () => {
  test("one page per plugin and section; subsections in order; the second section titled by its subsection", () => {
    const pages = buildSettingsPages([agent], []);
    expect(pages.map((p) => [p.id, p.group, p.title, p.primary])).toEqual([
      ["valet-agent", "system", "Agent", true],
      ["valet-agent:inference", "inference", "Models", false],
    ]);
    expect(pages[0]?.subsections.map((s) => s.id)).toEqual(["chat", "tools"]);
    expect(pages[0]?.icon).toBe("bot");
    expect(pages[1]?.order).toBe(900);
  });

  test("runtime subsections land on their section, defaulting to the doc's first", () => {
    const pages = buildSettingsPages([agent], [usage("valet-agent", "inference")]);
    expect(pages[0]?.runtime).toEqual([]);
    expect(pages[1]?.runtime.map((r) => r.id)).toEqual(["usage"]);
    const first = buildSettingsPages([agent], [usage("valet-agent")]);
    expect(first[0]?.runtime.map((r) => r.id)).toEqual(["usage"]);
    expect(first[0]?.contribution?.actions).toEqual(["refresh"]);
  });

  test("a raw configSchema gets a plain generated form, filed by provides", () => {
    const [page] = buildSettingsPages([raw], []);
    expect(page?.group).toBe("tools");
    expect(page?.subsections[0]?.items).toEqual([
      { id: "n", label: "N", input: { type: "int", default: 3 } },
      { id: "tags", label: "tags", input: { type: "tags" } },
    ]);
  });

  test("a plugin with neither settings nor runtime subsections has no page; a contribution alone gets one", () => {
    const bare = { ...raw, plugin: "valet-bare", schema: undefined };
    expect(buildSettingsPages([bare], [])).toEqual([]);
    const pages = buildSettingsPages([], [usage("valet-auth")]);
    expect(pages.map((p) => [p.id, p.group])).toEqual([["valet-auth", "system"]]);
  });

  test("groupPages sorts by group order then page order", () => {
    const grouped = groupPages(buildSettingsPages([agent, raw], []));
    expect(grouped.map((g) => g.group)).toEqual(["system", "inference", "tools"]);
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
