import { afterEach, expect, test } from "bun:test";
import type { PluginContext } from "@valethq/sdk";
import plugin from "../src/index";
import type { UiConfig } from "../src/server";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0).reverse()) await d();
});

async function activate(config: UiConfig) {
  const urls: string[] = [];
  const listeners: ((next: UiConfig, prev: UiConfig) => Promise<void>)[] = [];
  const ctx = {
    config,
    scopes: { define: () => undefined },
    http: { route: () => undefined },
    log: {
      info: (_msg: string, data?: { url?: string }) => data?.url && urls.push(data.url),
      warn: (_msg: string, data?: { url?: string }) => data?.url && urls.push(data.url),
    },
    onDispose: (fn: () => void) => disposers.push(fn),
    onConfigChange: (fn: (typeof listeners)[number]) => listeners.push(fn),
  } as unknown as PluginContext<UiConfig>;
  await plugin.activate(ctx);
  const reload = async (next: UiConfig) => {
    for (const fn of listeners) await fn(next, config);
    config = next;
  };
  return { urls, reload };
}

const proxiedTo = async (url: string) =>
  ((await (await fetch(`${url}/api/ping`)).json()) as { from: string }).from;

function fakeCore(from: string) {
  const core = Bun.serve({ port: 0, fetch: () => Response.json({ from }) });
  disposers.push(() => core.stop(true));
  return `http://127.0.0.1:${core.port}`;
}

test("a config reload restarts the web server against the new coreUrl", async () => {
  const { urls, reload } = await activate({ port: 0, coreUrl: fakeCore("a") });
  expect(await proxiedTo(urls[0] as string)).toBe("a");
  await reload({ port: 0, coreUrl: fakeCore("b") });
  expect(urls).toHaveLength(2);
  expect(await proxiedTo(urls[1] as string)).toBe("b");
  await expect(fetch(`${urls[0]}/`)).rejects.toThrow();
});

test("a failed restart brings the previous server back and reports the error", async () => {
  const blocker = Bun.serve({ port: 0, fetch: () => new Response("x") });
  disposers.push(() => blocker.stop(true));
  const { urls, reload } = await activate({ port: 0, coreUrl: fakeCore("a") });
  await expect(reload({ port: blocker.port as number, coreUrl: fakeCore("b") })).rejects.toThrow();
  expect(await proxiedTo(urls.at(-1) as string)).toBe("a");
});
