import { expect, test } from "bun:test";
import type { PluginContext, ScopeProvider, SettingsPanel } from "@valethq/sdk";
import { registerSettings } from "../src/settings";

type Handler = (req: Request, c: { params: Record<string, string> }) => Promise<Response>;

function setup(panels: Record<string, SettingsPanel>) {
  const routes = new Map<string, Handler>();
  const defs: unknown[] = [];
  const ctx = {
    scopes: {
      define: (d: unknown) => defs.push(d),
      all: () =>
        Object.entries(panels).map(
          ([key, impl]) => ({ key, plugin: `valet-${key}`, impl }) as ScopeProvider<"settings">,
        ),
    },
    http: { route: (m: string, p: string, h: Handler) => routes.set(`${m} ${p}`, h) },
  } as unknown as PluginContext;
  registerSettings(ctx);
  const call = (route: string, params: Record<string, string> = {}, body?: string) =>
    (routes.get(route) as Handler)(new Request("http://x/", { method: route.split(" ")[0], body }), {
      params,
    });
  return { defs, call };
}

test("defines the scope and lists panels with current values", async () => {
  let value = { a: 1 };
  const { defs, call } = setup({
    foo: {
      title: "Foo",
      schema: { type: "object" },
      get: () => value,
      set: (v) => {
        value = v as typeof value;
      },
    },
  });
  expect(defs).toEqual([{ name: "settings", version: 1, cardinality: "many" }]);
  expect(await (await call("GET /settings")).json()).toEqual([
    { key: "foo", plugin: "valet-foo", title: "Foo", schema: { type: "object" }, values: { a: 1 } },
  ]);
  const put = await call("PUT /settings/:key", { key: "foo" }, '{"a":2}');
  expect(((await put.json()) as { values: unknown }).values).toEqual({ a: 2 });
});

test("rejects unknown panels, bad bodies and provider errors", async () => {
  const { call } = setup({
    foo: {
      title: "Foo",
      schema: {},
      get: () => ({}),
      set: () => {
        throw new Error("nope");
      },
    },
  });
  expect((await call("GET /settings/:key", { key: "bar" })).status).toBe(404);
  expect((await call("PUT /settings/:key", { key: "foo" }, "[1]")).status).toBe(400);
  const res = await call("PUT /settings/:key", { key: "foo" }, "{}");
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: "nope" });
});

test("a view-only panel lists its blocks and refresh hint, with no form", async () => {
  const { call } = setup({
    usage: {
      title: "Usage",
      page: "models",
      refreshMs: 30_000,
      view: () => [{ type: "meter", label: "Session", value: 44 }],
    },
  });
  expect(await (await call("GET /settings/:key", { key: "usage" })).json()).toEqual({
    key: "usage",
    plugin: "valet-usage",
    title: "Usage",
    page: "models",
    blocks: [{ type: "meter", label: "Session", value: 44 }],
    refreshMs: 30_000,
  });
  const put = await call("PUT /settings/:key", { key: "usage" }, "{}");
  expect(put.status).toBe(405);
});

test("a throwing view is reported on the entry without failing the list", async () => {
  const { call } = setup({
    bad: {
      title: "Bad",
      view: () => {
        throw new Error("no data yet");
      },
    },
    ok: { title: "Ok", schema: {}, get: () => ({ a: 1 }) },
  });
  const list = (await (await call("GET /settings")).json()) as { key: string; viewError?: string }[];
  expect(list.map((e) => [e.key, e.viewError])).toEqual([
    ["bad", "no data yet"],
    ["ok", undefined],
  ]);
});

test("runs a panel action with its args, then returns the fresh panel", async () => {
  const seen: unknown[] = [];
  const { call } = setup({
    usage: {
      title: "Usage",
      view: () => [{ type: "text", text: `ran ${seen.length}` }],
      actions: {
        refresh: (args) => {
          seen.push(args);
        },
        fail: () => {
          throw new Error("denied");
        },
      },
    },
  });
  const res = await call("POST /settings/:key/actions/:name", { key: "usage", name: "refresh" }, '{"id":7}');
  expect(seen).toEqual([{ id: 7 }]);
  expect(((await res.json()) as { blocks: unknown }).blocks).toEqual([{ type: "text", text: "ran 1" }]);
  await call("POST /settings/:key/actions/:name", { key: "usage", name: "refresh" });
  expect(seen[1]).toEqual({});
  expect((await call("POST /settings/:key/actions/:name", { key: "usage", name: "fail" })).status).toBe(422);
  expect((await call("POST /settings/:key/actions/:name", { key: "usage", name: "nope" })).status).toBe(404);
  expect((await call("POST /settings/:key/actions/:name", { key: "usage", name: "toString" })).status).toBe(
    404,
  );
  expect(
    (await call("POST /settings/:key/actions/:name", { key: "usage", name: "refresh" }, "[1]")).status,
  ).toBe(400);
});
