import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, authStatus, listProjects, listSettings, saveSettings, sendMessage } from "../src/app/api";

const g = globalThis as Record<string, unknown>;
const realFetch = g.fetch;
const realTimeout = AbortSignal.timeout;
const realWindow = g.window;

let timeouts: number[] = [];

afterEach(() => {
  g.fetch = realFetch;
  AbortSignal.timeout = realTimeout;
  g.window = realWindow;
});

function stubFetch(handler: () => Response): void {
  g.window = { VALET: { coreUrl: "http://core.test/" } };
  timeouts = [];
  AbortSignal.timeout = ((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  }) as typeof AbortSignal.timeout;
  g.fetch = (() => Promise.resolve(handler())) as unknown as typeof fetch;
}

describe("request timeouts", () => {
  test("sendMessage fails fast with an 8s timeout", async () => {
    stubFetch(() => new Response('{"id":"msg_1"}', { status: 200 }));
    await sendMessage("ses_1", "hi", "cm_1");
    expect(timeouts).toEqual([8_000]);
  });

  test("other calls keep the 15s default", async () => {
    stubFetch(() => new Response("[]", { status: 200 }));
    await listProjects();
    expect(timeouts).toEqual([15_000]);
  });
});

describe("sendMessage failure", () => {
  test("a dead network surfaces as an ApiError with status 0", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await sendMessage("ses_1", "hi", "cm_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toBe("Network unreachable, try again");
  });
});

describe("settings", () => {
  test("saveSettings PUTs the values to valet-ui's route on core", async () => {
    let seen: { url: string; method?: string; body?: unknown } = { url: "" };
    g.window = { VALET: { coreUrl: "http://core.test/" } };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, method: init.method, body: init.body };
      return Promise.resolve(new Response('{"key":"agent","values":{"a":2}}'));
    }) as unknown as typeof fetch;
    await saveSettings("agent/main", { a: 2 });
    expect(seen).toEqual({
      url: "http://core.test/plugins/valet-ui/settings/agent%2Fmain",
      method: "PUT",
      body: '{"a":2}',
    });
  });

  test("a provider's rejection message surfaces as the error text", async () => {
    stubFetch(() => new Response('{"error":"port is taken"}', { status: 422 }));
    const err = await listSettings().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe("port is taken");
  });
});

describe("authStatus", () => {
  test("valet-auth's setupRequired means first-boot setup", async () => {
    stubFetch(() => new Response('{"setupRequired":true}', { status: 200 }));
    expect((await authStatus()).needsSetup).toBe(true);
    stubFetch(() => new Response('{"setupRequired":false}', { status: 200 }));
    expect((await authStatus()).needsSetup).toBe(false);
  });
});
