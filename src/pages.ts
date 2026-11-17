import { createHash } from "node:crypto";
import { firstRound, roundPieces, type WireEntry } from "./chunking";
import { compressResponse } from "./compress";
import { type ChunkConfig, pageOf, roundBudget } from "./paging";
import { upstreamHeaders } from "./proxy";

const ROUTE = /^\/ui\/messages\/([^/]+)$/;

export const isPagePath = (path: string): boolean => ROUTE.test(path);

const etagOf = (body: string): string =>
  `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;

/** An ETag as the browser hands it back: weakened by compression, quoted. */
const bare = (etag: string): string => etag.replace(/^W\//, "").replaceAll('"', "");

const count = (raw: string | null): number | null => (raw === null ? null : Number(raw));
const whole = (n: number | null, min: number): boolean => n === null || (Number.isInteger(n) && n >= min);

/** A page of one chat, read from core over loopback. `?page=n` is that fixed page; no `page` is the newest one.
 * The body is `{ page, messages }`: long text and tool output arrive cut to a first piece and say how long they
 * really are (`partial`). It carries nothing that changes when later pages are added, so a sealed page keeps its
 * ETag and revalidating it answers 304. `?page=n&round=k&v=<etag>` is the k-th round of the rest of that page:
 * `{ page, round, pieces, done }`, answered 409 if the page changed since `v`. Core still does the access check:
 * the caller's credentials are forwarded as they are. */
export async function pageResponse(req: Request, coreUrl: string, chunk: ChunkConfig): Promise<Response> {
  const url = new URL(req.url);
  const sid = decodeURIComponent((ROUTE.exec(url.pathname) as RegExpExecArray)[1] as string);
  const wanted = count(url.searchParams.get("page"));
  const round = count(url.searchParams.get("round"));
  if (!whole(wanted, 0) || !whole(round, 1) || (round !== null && wanted === null)) {
    return Response.json({ error: "bad page or round" }, { status: 400 });
  }
  const { chunkMessages: size, partChars } = chunk;
  const query = wanted === null ? `limit=${size}` : `beforeSeq=${(wanted + 1) * size + 1}&limit=${size}`;
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
  const list = (await upstream.json()) as WireEntry[];
  const page = wanted ?? pageOf(Math.max(0, ...list.map((m) => m.message.seq)), size);
  const entries = list.filter((m) => pageOf(m.message.seq, size) === page);
  const budget = roundBudget(chunk);
  const first = JSON.stringify({ page, messages: firstRound(entries, partChars, budget) });
  const etag = etagOf(first);

  if (round !== null) {
    if (bare(url.searchParams.get("v") ?? "") !== bare(etag)) {
      return Response.json({ error: "changed" }, { status: 409 });
    }
    const { pieces, done } = roundPieces(entries, partChars, budget, round);
    return compressResponse(
      req,
      Response.json({ page, round, pieces, done }, { headers: { "cache-control": "no-store" } }),
    );
  }

  const headers = { etag, "cache-control": "private, no-cache" };
  const sent = req.headers.get("if-none-match");
  if (sent?.split(",").some((t) => bare(t.trim()) === bare(etag))) {
    return new Response(null, { status: 304, headers });
  }
  return compressResponse(
    req,
    new Response(first, { headers: { ...headers, "content-type": "application/json" } }),
  );
}
