// biome-ignore-all lint/suspicious/noTemplateCurlyInString: settings refs are written ${resolver:arg}
import { describe, expect, test } from "bun:test";
import {
  deriveGroup,
  evalCond,
  isModelCatalog,
  pasteName,
  patchFor,
  renderAs,
  resolveArgs,
  secretNameOf,
  shown,
  sourceRef,
  splitAdvanced,
  stacksBelow,
} from "../src/app/settings-model";

describe("renderAs: a type this UI doesn't know renders its base", () => {
  test("known types render as themselves", () => {
    expect(renderAs({ type: "percent", max: 1 })).toEqual({
      type: "percent",
      f: { type: "percent", max: 1 },
    });
  });

  test("recipes and newer catalog types fall back along their chain, keeping presets", () => {
    const types = {
      "local:hostport": { base: "strict_string", pattern: "^x$" },
      sparkle: { base: "local:hostport", patternHint: "h:p" },
    };
    expect(renderAs({ type: "sparkle", label: "S" }, types)).toEqual({
      type: "strict_string",
      f: { type: "strict_string", pattern: "^x$", patternHint: "h:p", label: "S" },
    });
    expect(renderAs({ type: "mystery" }).type).toBe("string");
    expect(renderAs({ type: "a" }, { a: { base: "a" } }).type).toBe("string");
  });
});

describe("model catalog discriminator", () => {
  test("the schema style marks the editor, not the plugin id or setting id", () => {
    const setting = (id: string, type: string, style?: string) => ({
      id,
      label: id,
      input: { type, ...(style === undefined ? {} : { style }) },
    });
    expect(isModelCatalog(setting("models", "list", "model-catalog"))).toBe(true);
    expect(isModelCatalog(setting("anything", "list", "model-catalog"))).toBe(true);
    expect(isModelCatalog(setting("models", "list", "table"))).toBe(false);
    expect(isModelCatalog(setting("models", "list"))).toBe(false);
  });
});

describe("conditions and args", () => {
  const root = { mode: "advanced", model: { id: "m1" }, nil: null };
  test("evalCond reads stored values; absent and null are not set", () => {
    expect(evalCond(undefined, root)).toBe(true);
    expect(evalCond({ eq: ["mode", "advanced"] }, root)).toBe(true);
    expect(evalCond({ set: "nil" }, root)).toBe(false);
    expect(evalCond({ ne: ["missing", 1] }, root)).toBe(true);
    expect(evalCond({ in: ["model.id", ["m1", "m2"]] }, root)).toBe(true);
    expect(evalCond({ all: [{ set: "mode" }, { not: { set: "nil" } }] }, root)).toBe(true);
    expect(evalCond({ eq: ["@.on", true] }, root, { on: true })).toBe(true);
  });

  test("resolveArgs fills { $: path } from the form", () => {
    expect(resolveArgs({ model: { $: "model.id" }, fixed: 1 }, root)).toEqual({ model: "m1", fixed: 1 });
    expect(resolveArgs({ p: { $: "@.provider" } }, root, { provider: "x" })).toEqual({ p: "x" });
  });

  test("sourceRef: own plugin or <plugin>/name", () => {
    expect(sourceRef("models", "valet-claudecode")).toEqual({ plugin: "valet-claudecode", name: "models" });
    expect(sourceRef("valet-agent/models", "x")).toEqual({ plugin: "valet-agent", name: "models" });
  });
});

describe("saves", () => {
  test("only touched keys go out; unset is null, a reset to inherited", () => {
    const values: Record<string, unknown> = { a: 1, g: { x: 1 } };
    expect(patchFor(["a", "g", "b"], (id) => values[id])).toEqual({ a: 1, g: { x: 1 }, b: null });
  });

  test("deprecated settings show only while a layer stores them", () => {
    const s = { id: "old", label: "Old", input: { type: "bool" }, deprecated: "gone" };
    expect(shown(s, {})).toBe(false);
    expect(shown(s, { file: { old: true } })).toBe(true);
    expect(shown({ ...s, deprecated: undefined }, {})).toBe(true);
  });

  test("secret refs and Paste names", () => {
    expect(secretNameOf("${secret:cursor_api_key}")).toBe("cursor_api_key");
    expect(secretNameOf("Bearer ${secret:x}")).toBeUndefined();
    expect(pasteName("valet-modelapi", "endpoints[0].apiKey")).toBe("valet-modelapi.endpoints.0.apiKey");
    expect(pasteName("p", 'm["a b"]')).toBe("p.m.a_b");
  });

  test("deriveGroup files raw-schema plugins by provides", () => {
    expect(deriveGroup(["inference@1"])).toBe("inference");
    expect(deriveGroup(["tools@1", "settings@2"])).toBe("tools");
    expect(deriveGroup(["context@1", "tools@1"])).toBe("system");
  });
});

describe("settings layout", () => {
  test("lists, groups, long text and secrets stack under their label; short controls sit beside it", () => {
    for (const type of ["list", "map", "group", "code", "text", "tags", "multiselect", "secret"])
      expect(stacksBelow({ type })).toBe(true);
    for (const type of ["bool", "number", "int", "duration", "string", "path", "select", "ref"])
      expect(stacksBelow({ type })).toBe(false);
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}` }));
    expect(stacksBelow({ type: "select", style: "segmented", options: opts(2) })).toBe(false);
    expect(stacksBelow({ type: "select", style: "cards", options: opts(4) })).toBe(true);
    expect(stacksBelow({ type: "model" }, { model: { base: "group" } })).toBe(true);
  });

  test("advanced settings move to one group; subsections left empty disappear", () => {
    const set = (id: string, advanced?: boolean) => ({
      id,
      label: id,
      input: { type: "bool" },
      ...(advanced === undefined ? {} : { advanced }),
    });
    const { main, advanced } = splitAdvanced([
      { id: "tools", label: "Tools", items: [set("a"), set("b", true), { type: "note", text: "n" }] },
      { id: "models", label: "Models", items: [set("c", true)] },
      { id: "runtime", label: "Runtime", items: [set("d")] },
    ]);
    expect(main.map((s) => [s.id, s.items.length])).toEqual([
      ["tools", 2],
      ["runtime", 1],
    ]);
    expect(advanced.map((s) => [s.id, s.items.map((i) => (i as { id: string }).id)])).toEqual([
      ["tools", ["b"]],
      ["models", ["c"]],
    ]);
  });
});
