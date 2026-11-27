import { describe, expect, test } from "bun:test";
import type { AuthResult, PluginContext } from "@valethq/sdk";
import { authorizeStreamRequest } from "../src/stream-auth";

function ctxWith(auth: AuthResult | undefined, role: "owner" | "guest" = "owner"): PluginContext {
  const principal = { id: "p1", displayName: "Owner", role };
  return {
    plugin: { id: "valet-ui" },
    log: { error: () => undefined },
    scopes: {
      all: (scope: string) =>
        scope === "identity" && auth !== undefined
          ? [{ key: "valet-auth", plugin: "valet-auth", impl: { authenticate: () => auth } }]
          : [],
      maybe: () => undefined,
    },
    store: { principals: { get: (id: string) => (id === "p1" ? principal : undefined) } },
    acl: {
      permission: (name: string) =>
        name === "ui:stream.read" ? { summary: "stream", default: "owner" } : undefined,
      credential: () => ({ active: true }),
    },
  } as unknown as PluginContext;
}

describe("stream authorization", () => {
  test("an authenticated owner may open streams", async () => {
    const ok = await authorizeStreamRequest(ctxWith({ principalId: "p1" }), new Request("http://ui/stream"));
    expect(ok).toBe(true);
  });

  test("anonymous and lower-role principals may not", async () => {
    expect(await authorizeStreamRequest(ctxWith(undefined), new Request("http://ui/stream"))).toBe(false);
    expect(
      await authorizeStreamRequest(ctxWith({ principalId: "p1" }, "guest"), new Request("http://ui/stream")),
    ).toBe(false);
  });
});
