import { expect, test } from "bun:test";
import type { PluginContext, ScopeProvider } from "@valethq/sdk";
import { registerSettings, type SettingsPanel } from "../src/settings";

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
