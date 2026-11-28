import type { PluginContext } from "@valethq/sdk";

const DROP_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "content-length",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "sec-websocket-extensions",
]);

/** Core identifies and permission-checks this route; the handler only runs after ui:stream.read is granted. */
export function registerStreamAuth(ctx: PluginContext): void {
  ctx.http.route("GET", "/stream-auth", () => Response.json({ ok: true }), { permission: "ui:stream.read" });
}

/** Authorizes the UI server's own endpoints through core rather than replicating control-plane authentication. */
export async function authorizeStreamRequest(ctx: PluginContext, req: Request): Promise<boolean> {
  const headers = new Headers();
  for (const [name, value] of req.headers) {
    if (!DROP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  try {
    const res = await ctx.control.dispatch(
      new Request(ctx.http.url("/stream-auth"), { method: "GET", headers }),
    );
    if (!res.ok) ctx.log.debug("stream authorization refused", { status: res.status });
    return res.ok;
  } catch (error) {
    ctx.log.warn("stream authorization failed", { error: String(error) });
    return false;
  }
}
