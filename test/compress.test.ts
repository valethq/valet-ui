import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { asset, compressResponse, pickEncoding, serveAsset } from "../src/compress";
import { startUiServer, type UiServer } from "../src/server";

const big = JSON.stringify(
  Array.from({ length: 400 }, (_, i) => ({ id: i, text: "hello world ".repeat(8) })),
);
const req = (headers: Record<string, string> = {}, init: RequestInit = {}): Request =>
  new Request("http://x/api/core/x", { headers, ...init });
const json = (body: string, headers: Record<string, string> = {}, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

describe("pickEncoding", () => {
  test("prefers brotli, falls back to gzip, honours refusals", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding("gzip;q=0")).toBeNull();
    expect(pickEncoding(null)).toBeNull();
  });
});

describe("compressResponse", () => {
  test("brotli round-trips and marks the response", async () => {
    const res = await compressResponse(req({ "accept-encoding": "br, gzip" }), json(big, { etag: '"abc"' }));
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toBe("accept-encoding");
    expect(res.headers.get("etag")).toBe('W/"abc"');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeLessThan(big.length / 5);
    expect(new TextDecoder().decode(brotliDecompressSync(body))).toBe(big);
  });

  test("gzip when brotli is not accepted", async () => {
    const res = await compressResponse(req({ "accept-encoding": "gzip" }), json(big));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await res.arrayBuffer())).toString()).toBe(big);
  });

  test("small bodies, other types, ranges, HEAD, 204s and already-encoded bodies pass through", async () => {
    const accept = { "accept-encoding": "br" };
    const small = await compressResponse(req(accept), json('{"ok":true}'));
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(await small.text()).toBe('{"ok":true}');

    const png = new Response(big, { headers: { "content-type": "image/png" } });
    expect((await compressResponse(req(accept), png)).headers.get("content-encoding")).toBeNull();
    const sse = new Response(big, { headers: { "content-type": "text/event-stream" } });
    expect((await compressResponse(req(accept), sse)).headers.get("content-encoding")).toBeNull();

    const ranged = await compressResponse(req({ ...accept, range: "bytes=0-9" }), json(big));
    expect(ranged.headers.get("content-encoding")).toBeNull();
    const head = await compressResponse(req(accept, { method: "HEAD" }), json(big));
    expect(head.headers.get("content-encoding")).toBeNull();
    const partial = await compressResponse(req(accept), json(big, {}, 206));
    expect(partial.headers.get("content-encoding")).toBeNull();
    const encoded = await compressResponse(req(accept), json(big, { "content-encoding": "gzip" }));
    expect(encoded.headers.get("content-encoding")).toBe("gzip");
    expect((await compressResponse(req(), json(big))).headers.get("content-encoding")).toBeNull();
  });
});

describe("serveAsset", () => {
  const a = asset("text/javascript", "console.log(1);\n".repeat(200));

  test("sends the best encoding with a content-hash etag that revalidates to 304", async () => {
    const res = await serveAsset(req({ "accept-encoding": "gzip, br" }), a, { x: "y" });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x")).toBe("y");
    expect(new TextDecoder().decode(brotliDecompressSync(new Uint8Array(await res.arrayBuffer())))).toContain(
      "console.log(1);",
    );
    const again = await serveAsset(req({ "if-none-match": a.etag, "accept-encoding": "br" }), a, {});
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  test("identity when the client accepts nothing, and a new body gets a new etag", async () => {
    const res = await serveAsset(req(), a, {});
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.text()).length).toBe(3200);
    expect(asset("text/javascript", "other").etag).not.toBe(a.etag);
  });
});

describe("ui server compression", () => {
  let core: ReturnType<typeof Bun.serve>;
  let server: UiServer;
  beforeAll(async () => {
    core = Bun.serve({ port: 0, fetch: () => json(big) });
    server = await startUiServer({ port: 0, coreUrl: `http://127.0.0.1:${core.port}` });
  });
  afterAll(() => {
    server.stop();
    core.stop(true);
  });

  const raw = (path: string, headers: Record<string, string>) =>
    fetch(`${server.url}${path}`, { headers: { "accept-encoding": "br, gzip", ...headers } });

  test("the page, bundle and API come back compressed and intact", async () => {
    const plain = await (await fetch(`${server.url}/app.js`)).text();
    const bundle = await raw("/app.js", {});
    expect(bundle.headers.get("etag")).not.toBeNull();
    expect(await bundle.text()).toBe(plain);
    const html = await raw("/", {});
    expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await html.text()).toContain('src="/app.js"');
    const api = await raw("/api/core/x", {});
    expect(api.headers.get("vary")).toBe("accept-encoding");
    expect(await api.text()).toBe(big);
  });

  test("a conditional request for the bundle is a 304", async () => {
    const first = await raw("/app.js", {});
    const second = await raw("/app.js", { "if-none-match": first.headers.get("etag") as string });
    expect(second.status).toBe(304);
  });
});
