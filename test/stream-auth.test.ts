import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@valethq/sdk";
import { authorizeStreamRequest } from "../src/stream-auth";

function ctxWith(status: number, seen: { req?: Request }): PluginContext {
  return {
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    http: { url: (path: string) => `http://core/plugins/valet-ui${path}` },
    control: {
      dispatch: async (req: Request) => {
        seen.req = req;
        return new Response(null, { status });
      },
    },
  } as unknown as PluginContext;
}

describe("stream authorization", () => {
  test("core's permission decision is the stream decision", async () => {
    const seen: { req?: Request } = {};
    expect(await authorizeStreamRequest(ctxWith(200, seen), new Request("http://ui/stream"))).toBe(true);
    expect(await authorizeStreamRequest(ctxWith(403, seen), new Request("http://ui/stream"))).toBe(false);
  });

  test("authentication evidence is forwarded without websocket transport headers", async () => {
    const seen: { req?: Request } = {};
    const req = new Request("http://ui/stream", {
      headers: {
        cookie: "valet_session=secret",
        authorization: "Bearer token",
        "sec-websocket-key": "drop-me",
        origin: "https://ui",
      },
    });
    expect(await authorizeStreamRequest(ctxWith(200, seen), req)).toBe(true);
    expect(seen.req?.headers.get("cookie")).toBe("valet_session=secret");
    expect(seen.req?.headers.get("authorization")).toBe("Bearer token");
    expect(seen.req?.headers.get("sec-websocket-key")).toBeNull();
    expect(seen.req?.headers.get("origin")).toBeNull();
  });
});
