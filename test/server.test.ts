import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startUiServer, type UiServer } from "../src/server";

describe("ui server", () => {
  let server: UiServer;
  let base: string;

  beforeAll(async () => {
    server = await startUiServer({ port: 0 });
    base = server.url;
  });
  afterAll(() => server.stop());

  test("serves index html at /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("window.VALET");
    expect(html).toContain('"coreUrl":"http://127.0.0.1:7417"');
    expect(html).toContain('src="/app.js"');
  });

  test("serves the SPA bundle at /app.js", async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test("strict CSP allows the core origin and its ws form", async () => {
    const res = await fetch(`${base}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:7417 ws://127.0.0.1:7417");
    expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'/);
  });

  test("404s everywhere else and on non-GET", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/app.js/extra`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(404);
  });
});

describe("ui server config", () => {
  let server: UiServer;
  afterAll(() => server?.stop());

  test("coreUrl and port are honoured", async () => {
    server = await startUiServer({ port: 0, coreUrl: "http://127.0.0.1:9999/" });
    const html = await (await fetch(`${server.url}/`)).text();
    expect(html).toContain('"coreUrl":"http://127.0.0.1:9999"');
    const csp = (await fetch(`${server.url}/`)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("http://127.0.0.1:9999 ws://127.0.0.1:9999");
    expect(server.port).toBeGreaterThan(0);
  });
});
