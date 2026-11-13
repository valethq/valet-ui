import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, listProjects, sendMessage } from "../src/app/api";

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
