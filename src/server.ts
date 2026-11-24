import { createHash } from "node:crypto";
import { join } from "node:path";
import { asset, serveAsset } from "./compress";
import { type ChunkConfig, chunkConfig } from "./paging";
import { indexHtml, bootScript } from "./page";
import { isPagePath, pageResponse } from "./pages";
import { isProxied, openUpstream, proxyRequest, sameOrigin, type WsData, wsHandlers } from "./proxy";

export interface UiConfig extends Partial<ChunkConfig> {
  host?: string;
  port?: number;
  coreUrl?: string;
}

export interface UiServer {
  readonly url: string;
  readonly port: number;
  stop(): void;
}

export interface UiServerOptions extends UiConfig {
  /** SPA entrypoint; defaults to src/app/main.ts next to this file. */
  entrypoint?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7418;
const DEFAULT_CORE_URL = "http://127.0.0.1:7417";

function csp(): string {
  const scriptHash = createHash("sha256").update(bootScript).digest("base64");
  return [
    "default-src 'none'",
    `script-src 'self' 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    "connect-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Serves the SPA on its own port (11.5) and relays its API and websocket traffic to core. */
export async function startUiServer(opts: UiServerOptions = {}): Promise<UiServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const coreUrl = (opts.coreUrl ?? DEFAULT_CORE_URL).replace(/\/+$/, "");
  const chunk = chunkConfig(opts);
  const entrypoint = opts.entrypoint ?? join(import.meta.dir, "app", "main.ts");

  const build = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    minify: true,
  });
  if (!build.success) {
    throw new Error(`valet-ui bundle failed: ${build.logs.map((l) => l.message).join("; ")}`);
  }
  const bundle = await build.outputs[0]?.text();
  if (bundle === undefined) throw new Error("valet-ui bundle produced no output");

  const font = await Bun.file(join(import.meta.dir, "app", "fonts", "public-sans-var.woff2")).arrayBuffer();
  const htmlAsset = asset("text/html; charset=utf-8", indexHtml());
  const headers = { "content-security-policy": csp() };
  const bundleAsset = asset("text/javascript; charset=utf-8", bundle);

  const server = Bun.serve<WsData>({
    hostname: host,
    port,
    websocket: wsHandlers,
    fetch(req, srv) {
      const path = new URL(req.url).pathname;
      if (isProxied(path)) {
        if (!sameOrigin(req)) return Response.json({ error: "origin not allowed" }, { status: 403 });
        if (path !== "/ws") return proxyRequest(req, coreUrl);
        const upgraded = srv.upgrade(req, { data: openUpstream(req, coreUrl) });
        return upgraded ? undefined : Response.json({ error: "websocket upgrade required" }, { status: 400 });
      }
      if (req.method !== "GET") return new Response("not found", { status: 404 });
      if (isPagePath(path)) {
        if (!sameOrigin(req)) return Response.json({ error: "origin not allowed" }, { status: 403 });
        return pageResponse(req, coreUrl, chunk);
      }
      if (path === "/") return serveAsset(req, htmlAsset, headers);
      if (path === "/app.js") return serveAsset(req, bundleAsset, headers);
      if (path === "/fonts/public-sans.woff2") {
        return new Response(font, {
          headers: { "content-type": "font/woff2", "cache-control": "public, max-age=86400", ...headers },
        });
      }
      return new Response("not found", { status: 404, headers });
    },
  });

  return {
    url: `http://${host}:${server.port ?? port}`,
    get port() {
      return server.port ?? -1;
    },
    stop() {
      server.stop(true);
    },
  };
}
