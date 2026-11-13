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

const coreUrlOf = async (url: string) =>
  ((await (await fetch(`${url}/`)).text()).match(/"coreUrl":"([^"]*)"/) ?? [])[1];

test("a config reload restarts the web server with the new coreUrl", async () => {
  const { urls, reload } = await activate({ port: 0, coreUrl: "http://a.test:1" });
  expect(await coreUrlOf(urls[0] as string)).toBe("http://a.test:1");
  await reload({ port: 0, coreUrl: "http://b.test:2" });
  expect(urls).toHaveLength(2);
  expect(await coreUrlOf(urls[1] as string)).toBe("http://b.test:2");
  await expect(fetch(`${urls[0]}/`)).rejects.toThrow();
});

test("a failed restart brings the previous server back and reports the error", async () => {
  const blocker = Bun.serve({ port: 0, fetch: () => new Response("x") });
  disposers.push(() => blocker.stop(true));
  const { urls, reload } = await activate({ port: 0, coreUrl: "http://a.test:1" });
  await expect(reload({ port: blocker.port as number, coreUrl: "http://b.test:2" })).rejects.toThrow();
  expect(await coreUrlOf(urls.at(-1) as string)).toBe("http://a.test:1");
});
