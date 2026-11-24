import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);

export type Encoding = "br" | "gzip";

const MIN_BYTES = 1024;
const TYPES = /^(application\/json|application\/javascript|image\/svg\+xml|text\/(?!event-stream))/i;

/** Best encoding the client accepts (br over gzip), honouring `q=0` refusals and `*`. */
export function pickEncoding(acceptEncoding: string | null): Encoding | null {
  if (acceptEncoding === null) return null;
  const q = new Map<string, number>();
  for (const item of acceptEncoding.split(",")) {
    const [name, ...params] = item.trim().toLowerCase().split(";");
    const weight = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find((w) => w !== undefined);
    if (name) q.set(name, weight === undefined ? 1 : Number(weight));
  }
  const ok = (e: Encoding): boolean => (q.get(e) ?? q.get("*") ?? 0) > 0;
  return ok("br") ? "br" : ok("gzip") ? "gzip" : null;
}

export function compressible(contentType: string | null): boolean {
  return contentType !== null && TYPES.test(contentType);
}

type Level = "fast" | "max";

type Bytes = Uint8Array<ArrayBuffer>;

export async function encode(body: Uint8Array, encoding: Encoding, level: Level): Promise<Bytes> {
  const out =
    encoding === "gzip"
      ? await deflate(body, { level: level === "max" ? 9 : 6 })
      : await brotli(body, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: level === "max" ? 11 : 5,
            [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
          },
        });
  return out as Bytes;
}

const weak = (etag: string): string => (etag.startsWith("W/") ? etag : `W/${etag}`);

/** Compresses a proxied response when the client accepts it. Anything that
 * isn't plainly a finite text body (ranges, streams, binaries, tiny bodies)
 * passes through untouched. */
export async function compressResponse(req: Request, res: Response): Promise<Response> {
  const encoding = pickEncoding(req.headers.get("accept-encoding"));
  if (
    encoding === null ||
    req.method === "HEAD" ||
    req.headers.has("range") ||
    res.status === 204 ||
    res.status === 206 ||
    res.status === 304 ||
    res.body === null ||
    res.headers.has("content-encoding") ||
    !compressible(res.headers.get("content-type"))
  ) {
    return res;
  }
  const body = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.append("vary", "accept-encoding");
  if (body.length < MIN_BYTES) return new Response(body, { status: res.status, headers });
  headers.set("content-encoding", encoding);
  const etag = headers.get("etag");
  if (etag !== null) headers.set("etag", weak(etag));
  return new Response(await encode(body, encoding, "fast"), { status: res.status, headers });
}

export interface Asset {
  readonly type: string;
  readonly etag: string;
  readonly raw: Bytes;
  variant(encoding: Encoding | null): Promise<Bytes>;
}

/** A static body with a content-hash ETag; each encoding is built at max quality on first use, then kept. */
export function asset(type: string, text: string): Asset {
  const raw = new TextEncoder().encode(text) as Bytes;
  const etag = `"${createHash("sha256").update(raw).digest("base64url").slice(0, 22)}"`;
  const cache = new Map<Encoding, Promise<Bytes>>();
  return {
    type,
    etag,
    raw,
    async variant(encoding) {
      if (encoding === null) return raw;
      let hit = cache.get(encoding);
      if (hit === undefined) {
        hit = encode(raw, encoding, "max");
        cache.set(encoding, hit);
      }
      return hit;
    },
  };
}

/** Serves an `asset`: revalidates on every load (304 when unchanged) and sends the best accepted encoding. */
export async function serveAsset(req: Request, a: Asset, extra: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": a.type,
    etag: a.etag,
    "cache-control": "no-cache",
    vary: "accept-encoding",
    ...extra,
  };
  const match = req.headers.get("if-none-match");
  if (match?.split(",").some((t) => t.trim() === a.etag)) {
    return new Response(null, { status: 304, headers });
  }
  const encoding = pickEncoding(req.headers.get("accept-encoding"));
  if (encoding !== null) headers["content-encoding"] = encoding;
  return new Response(await a.variant(encoding), { headers });
}
