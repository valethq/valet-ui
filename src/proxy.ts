import { compressResponse } from "./compress";

/** Relays the browser's control-plane traffic to core, so only this plugin's port needs to be reachable. */

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
];
const DROP_REQUEST = ["host", "origin", "referer", "accept-encoding", ...HOP_BY_HOP];

type BunWebSocket = new (url: string, opts: { headers: Record<string, string> }) => WebSocket;

export interface WsData {
  upstream: WebSocket;
  pending: string[];
}

export function isProxied(path: string): boolean {
  return path === "/ws" || path.startsWith("/api/") || path.startsWith("/plugins/");
}

/** Browsers send Origin on every cross-origin and non-GET request; core's allowedOrigins check is replaced by this one. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || new URL(origin).host === req.headers.get("host");
}

function upstreamHeaders(req: Request): Headers {
  const headers = new Headers(req.headers);
  for (const name of DROP_REQUEST) headers.delete(name);
  return headers;
}

export async function proxyRequest(req: Request, coreUrl: string, compress = false): Promise<Response> {
  const url = new URL(req.url);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await fetch(`${coreUrl}${url.pathname}${url.search}`, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });
    const headers = new Headers(upstream.headers);
    for (const name of HOP_BY_HOP) headers.delete(name);
    const res = new Response(upstream.body, { status: upstream.status, headers });
    return compress ? await compressResponse(req, res) : res;
  } catch {
    return Response.json({ error: "core unreachable" }, { status: 502 });
  }
}

/** Opens the core socket for an upgraded browser socket; frames sent before it opens are queued. */
export function openUpstream(req: Request, coreUrl: string): WsData {
  const headers: Record<string, string> = {};
  for (const name of ["cookie", "authorization"]) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const upstream = new (WebSocket as unknown as BunWebSocket)(`${coreUrl.replace(/^http/, "ws")}/ws`, {
    headers,
  });
  return { upstream, pending: [] };
}

export const wsHandlers: Bun.WebSocketHandler<WsData> = {
  open(ws) {
    const { upstream, pending } = ws.data;
    upstream.onopen = () => {
      for (const frame of pending.splice(0)) upstream.send(frame);
    };
    upstream.onmessage = (ev) => ws.send(ev.data as string);
    upstream.onclose = (ev) => ws.close(ev.code === 1005 || ev.code === 1006 ? 1011 : ev.code, ev.reason);
    upstream.onerror = () => ws.close(1011, "core unreachable");
  },
  message(ws, frame) {
    const { upstream, pending } = ws.data;
    const text = frame.toString();
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else pending.push(text);
  },
  close(ws) {
    ws.data.upstream.onclose = ws.data.upstream.onerror = null;
    ws.data.upstream.close();
  },
};
