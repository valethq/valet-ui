import { createHash } from "node:crypto";
import { compressResponse } from "./compress";
import { PAGE_SIZE, pageOf } from "./paging";
import { upstreamHeaders } from "./proxy";

const ROUTE = /^\/ui\/messages\/([^/]+)$/;

export const isPagePath = (path: string): boolean => ROUTE.test(path);

interface Entry {
  message: { seq: number };
}

const etagOf = (body: string): string =>
  `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;

/** A page of one chat, read from core over loopback. `?page=n` is that fixed page; no `page` is the newest one.
 * The body is `{ page, messages }` and carries nothing that changes when later pages are added, so a sealed
 * page keeps its ETag and the browser's revalidation answers 304. Core still does the access check: the
 * caller's credentials are forwarded as they are. */
export async function pageResponse(req: Request, coreUrl: string): Promise<Response> {
  const url = new URL(req.url);
  const sid = decodeURIComponent((ROUTE.exec(url.pathname) as RegExpExecArray)[1] as string);
  const raw = url.searchParams.get("page");
  const wanted = raw === null ? null : Number(raw);
  if (wanted !== null && (!Number.isInteger(wanted) || wanted < 0)) {
    return Response.json({ error: "page must be a non-negative integer" }, { status: 400 });
  }
  const query =
    wanted === null ? `limit=${PAGE_SIZE}` : `beforeSeq=${(wanted + 1) * PAGE_SIZE + 1}&limit=${PAGE_SIZE}`;
  let upstream: Response;
  try {
    upstream = await fetch(`${coreUrl}/api/core/sessions/${encodeURIComponent(sid)}/messages?${query}`, {
      headers: upstreamHeaders(req),
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "core unreachable" }, { status: 502 });
  }
  if (!upstream.ok) {
    const headers = new Headers();
    const type = upstream.headers.get("content-type");
    if (type !== null) headers.set("content-type", type);
    return new Response(await upstream.text(), { status: upstream.status, headers });
  }
  const list = (await upstream.json()) as Entry[];
  const page = wanted ?? pageOf(Math.max(0, ...list.map((m) => m.message.seq)));
  const body = JSON.stringify({ page, messages: list.filter((m) => pageOf(m.message.seq) === page) });
  const etag = etagOf(body);
  const headers = { etag, "cache-control": "private, no-cache" };
  const sent = req.headers.get("if-none-match");
  if (sent?.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return compressResponse(
    req,
    new Response(body, { headers: { ...headers, "content-type": "application/json" } }),
  );
}
