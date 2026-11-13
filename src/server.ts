import { createHash } from "node:crypto";
import { join } from "node:path";
import { indexHtml, configScript } from "./page";

export interface UiConfig {
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

function wsUrl(coreUrl: string): string {
  return coreUrl.replace(/^http/, "ws");
}

function csp(coreUrl: string): string {
  const scriptHash = createHash("sha256").update(configScript(coreUrl)).digest("base64");
  return [
    "default-src 'none'",
    `script-src 'self' 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    `connect-src 'self' ${coreUrl} ${wsUrl(coreUrl)}`,
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Serves the SPA on its own port (11.5). Nothing mounts on the control plane. */
export async function startUiServer(opts: UiServerOptions = {}): Promise<UiServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const coreUrl = (opts.coreUrl ?? DEFAULT_CORE_URL).replace(/\/+$/, "");
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
  const html = indexHtml(coreUrl);
  const headers = { "content-security-policy": csp(coreUrl) };

  const server = Bun.serve({
    hostname: host,
    port,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "GET") return new Response("not found", { status: 404 });
      if (path === "/") {
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
      }
      if (path === "/app.js") {
        return new Response(bundle, {
          headers: { "content-type": "text/javascript; charset=utf-8", ...headers },
        });
      }
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
