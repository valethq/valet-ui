import { expect, test } from "bun:test";
import type { PluginContext, ScopeProvider, SettingsContribution } from "@valethq/sdk";
import { registerSettings } from "../src/settings";

type Handler = (req: Request, c: { params: Record<string, string> }) => Promise<Response>;

function setup(contributions: Record<string, SettingsContribution>) {
  const routes = new Map<string, Handler>();
  const acls = new Map<string, { permission?: string; resource?: (req: Request) => { id: string } }>();
  const defs: unknown[] = [];
  const ctx = {
    scopes: {
      define: (d: unknown) => defs.push(d),
      all: () =>
        Object.entries(contributions).map(
          ([plugin, impl]) => ({ key: plugin, plugin, impl }) as ScopeProvider<"settings">,
        ),
    },
    http: {
      route: (m: string, p: string, h: Handler, acl: { permission?: string }) => {
        routes.set(`${m} ${p}`, h);
        acls.set(`${m} ${p}`, acl);
      },
    },
  } as unknown as PluginContext;
  registerSettings(ctx);
  const call = (route: string, params: Record<string, string> = {}, body?: string) =>
    (routes.get(route) as Handler)(new Request("http://x/", { method: route.split(" ")[0], body }), {
      params,
    });
  return { defs, call, acls };
}

test("routes declare ui:settings.read, and ui:settings.write for actions and saves, on the plugin resource", () => {
  const { acls } = setup({});
  expect(acls.get("GET /settings")?.permission).toBe("ui:settings.read");
  expect(acls.get("GET /settings/:plugin")?.permission).toBe("ui:settings.read");
  expect(acls.get("POST /settings/:plugin/options/:name")?.permission).toBe("ui:settings.read");
  expect(acls.get("POST /settings/:plugin/views/:name")?.permission).toBe("ui:settings.read");
  expect(acls.get("POST /settings/:plugin/actions/:name")?.permission).toBe("ui:settings.write");
  expect(acls.get("PUT /settings/:plugin/subsections/:id")?.permission).toBe("ui:settings.write");
  const resource = acls.get("PUT /settings/:plugin/subsections/:id")?.resource;
  expect(
    resource?.(new Request("http://x/plugins/valet-ui/settings/valet-tailscale/subsections/exposure")),
  ).toEqual({
    id: "plugin:valet-tailscale",
  });
  // Repeated slashes and encoding resolve to the plugin the router will serve, not another one.
  expect(
    resource?.(new Request("http://x/plugins///valet-ui/settings/valet-auth/subsections/exposure")),
  ).toEqual({ id: "plugin:valet-auth" });
  expect(
    resource?.(new Request("http://x/plugins/valet-ui/settings/valet-%61uth/subsections/exposure")),
  ).toEqual({ id: "plugin:valet-auth" });
});

test("defines settings@2 and lists each contribution: names and runtime subsections", async () => {
  const { defs, call } = setup({
    "valet-x": {
      options: { models: () => [{ value: "m" }] },
      actions: { refresh: () => {} },
      subsections: () => [
        {
          id: "usage",
          label: "Usage",
          refreshMs: 50,
          items: [{ type: "meter", label: "Session", value: 44 }],
        },
      ],
    },
  });
  expect(defs).toEqual([{ name: "settings", version: 2, cardinality: "many" }]);
  expect(await (await call("GET /settings")).json()).toEqual([
    {
      plugin: "valet-x",
      options: ["models"],
      views: [],
      actions: ["refresh"],
      subsections: [
        {
          id: "usage",
          label: "Usage",
          refreshMs: 1000,
          items: [{ type: "meter", label: "Session", value: 44 }],
          editable: false,
        },
      ],
    },
  ]);
});

test("runtime values come back without masked fields; set() takes the real values", async () => {
  let stored = { user: "owner", password: "hunter2" };
  const { call } = setup({
    "valet-auth": {
      subsections: () => [
        {
          id: "account",
          label: "Account",
          items: [
            { id: "user", label: "User", input: { type: "string" } },
            { id: "password", label: "Password", input: { type: "string", masked: true } },
          ],
          get: () => stored,
          set: (v) => {
            if (v.password === "") throw new Error("password is required");
            stored = v as typeof stored;
          },
        },
      ],
    },
  });
  const listed = (await (await call("GET /settings/:plugin", { plugin: "valet-auth" })).json()) as {
    subsections: { values: unknown; editable: boolean }[];
  };
  expect(listed.subsections[0]).toMatchObject({ values: { user: "owner" }, editable: true });
  const put = await call(
    "PUT /settings/:plugin/subsections/:id",
    { plugin: "valet-auth", id: "account" },
    '{"user":"o","password":"new-secret"}',
  );
  expect(put.status).toBe(200);
  expect(stored).toEqual({ user: "o", password: "new-secret" });
  const bad = await call(
    "PUT /settings/:plugin/subsections/:id",
    { plugin: "valet-auth", id: "account" },
    '{"password":""}',
  );
  expect(bad.status).toBe(422);
  expect(await bad.json()).toEqual({ error: "password is required" });
  expect(
    (await call("PUT /settings/:plugin/subsections/:id", { plugin: "valet-auth", id: "nope" }, "{}")).status,
  ).toBe(404);
  expect(
    (await call("PUT /settings/:plugin/subsections/:id", { plugin: "valet-auth", id: "account" }, "[1]"))
      .status,
  ).toBe(400);
});

test("options, views and actions run by name with args; inherited names are never handlers", async () => {
  const seen: unknown[] = [];
  const { call } = setup({
    "valet-x": {
      options: { efforts: ({ model }) => [{ value: `${model}-low` }] },
      views: { usage: () => ({ value: 10, display: "10% left" }) },
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
  const opts = await call(
    "POST /settings/:plugin/options/:name",
    { plugin: "valet-x", name: "efforts" },
    '{"model":"m"}',
  );
  expect(await opts.json()).toEqual([{ value: "m-low" }]);
  const view = await call("POST /settings/:plugin/views/:name", { plugin: "valet-x", name: "usage" });
  expect(await view.json()).toEqual({ value: 10, display: "10% left" });
  const act = await call(
    "POST /settings/:plugin/actions/:name",
    { plugin: "valet-x", name: "refresh" },
    '{"id":7}',
  );
  expect(((await act.json()) as { plugin: string }).plugin).toBe("valet-x");
  expect(seen).toEqual([{ id: 7 }]);
  expect(
    (await call("POST /settings/:plugin/actions/:name", { plugin: "valet-x", name: "fail" })).status,
  ).toBe(422);
  expect(
    (await call("POST /settings/:plugin/actions/:name", { plugin: "valet-x", name: "toString" })).status,
  ).toBe(404);
  expect((await call("POST /settings/:plugin/options/:name", { plugin: "nope", name: "x" })).status).toBe(
    404,
  );
});

test("a throwing subsections() is reported without failing the list", async () => {
  const { call } = setup({
    "valet-bad": {
      subsections: () => {
        throw new Error("no data yet");
      },
    },
  });
  const [bad] = (await (await call("GET /settings")).json()) as { error?: string; subsections: unknown[] }[];
  expect(bad).toMatchObject({ error: "no data yet", subsections: [] });
});
