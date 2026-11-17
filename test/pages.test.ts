import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PAGE_SIZE, pageOf } from "../src/paging";
import { pagingFor } from "../src/app/state";
import { startUiServer, type UiServer } from "../src/server";

describe("pageOf", () => {
  test("seqs start at 1 and fill a page before the next begins", () => {
    expect(PAGE_SIZE).toBe(25);
    expect([0, 1, 25, 26, 50, 51].map(pageOf)).toEqual([0, 0, 0, 1, 1, 2]);
  });

  test("pagingFor points at the page before the newest, and nowhere from page 0", () => {
    expect(pagingFor(4)).toMatchObject({ tail: 4, older: 3, loading: false });
    expect(pagingFor(0).older).toBeNull();
  });
});

const entry = (seq: number, text = "x") => ({
  message: { id: `msg_${seq}`, seq, sessionId: "ses_1", status: "complete", updatedAt: 1 },
  parts: [{ id: `prt_${seq}`, data: { type: "text", text } }],
});

describe("/ui/messages", () => {
  let core: ReturnType<typeof Bun.serve>;
  let server: UiServer;
  let total = 60;
  let text = "x";
  const seen: Request[] = [];

  beforeAll(async () => {
    core = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req);
        const url = new URL(req.url);
        const m = /^\/api\/core\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
        if (m === null) return new Response("nope", { status: 404 });
        if (m[1] === "ses_missing") {
          return Response.json({ error: { code: "not_found", reason: "unknown session" } }, { status: 404 });
        }
        if (req.headers.get("cookie") === null)
          return Response.json({ error: "unauthorized" }, { status: 401 });
        const before = Number(url.searchParams.get("beforeSeq") ?? total + 1);
        const limit = Number(url.searchParams.get("limit") ?? total);
        const seqs = Array.from({ length: total }, (_, i) => i + 1)
          .filter((s) => s < before)
          .slice(-limit);
        return Response.json(seqs.map((s) => entry(s, text)));
      },
    });
    server = await startUiServer({ port: 0, coreUrl: `http://127.0.0.1:${core.port}` });
  });
  afterAll(() => {
    server.stop();
    core.stop(true);
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${server.url}/ui/messages/${path}`, { headers: { cookie: "a=b", ...headers } });
  const seqsOf = async (res: Response) =>
    ((await res.json()) as { messages: { message: { seq: number } }[] }).messages.map((m) => m.message.seq);

  test("the newest page is the one holding the highest seq, and nothing older leaks in", async () => {
    const res = await get("ses_1");
    expect(res.status).toBe(200);
    const body = (await res.clone().json()) as { page: number };
    expect(body.page).toBe(2);
    expect(await seqsOf(res)).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  });

  test("a fixed page is exactly its seq range, in order", async () => {
    expect(await seqsOf(await get("ses_1?page=1"))).toEqual(Array.from({ length: 25 }, (_, i) => 26 + i));
    expect(await seqsOf(await get("ses_1?page=0"))).toEqual(Array.from({ length: 25 }, (_, i) => 1 + i));
    expect(await seqsOf(await get("ses_1?page=9"))).toEqual([]);
  });

  test("a full tail page and its fixed-page twin are the same bytes, so they share an etag", async () => {
    total = 50;
    const tail = await get("ses_1");
    const fixed = await get("ses_1?page=1");
    expect(tail.headers.get("etag")).toBe(fixed.headers.get("etag"));
    total = 60;
  });

  test("an unchanged page revalidates to 304, a changed one does not", async () => {
    const first = await get("ses_1?page=1");
    const etag = first.headers.get("etag") as string;
    expect(etag).toMatch(/^(W\/)?"[\w-]{22}"$/);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const same = await get("ses_1?page=1", { "if-none-match": etag });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");
    text = "edited";
    const changed = await get("ses_1?page=1", { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    text = "x";
  });

  test("a page that grew new neighbours keeps its etag", async () => {
    const before = (await get("ses_1?page=0")).headers.get("etag");
    total = 90;
    expect((await get("ses_1?page=0")).headers.get("etag")).toBe(before);
    total = 60;
  });

  test("compressed pages still revalidate with the weak etag the browser sends back", async () => {
    const res = await get("ses_1?page=1", { "accept-encoding": "br" });
    expect(res.headers.get("content-encoding")).toBe("br");
    const etag = res.headers.get("etag") as string;
    expect(etag.startsWith("W/")).toBe(true);
    expect((await get("ses_1?page=1", { "if-none-match": etag })).status).toBe(304);
    const body = (await (await get("ses_1?page=1", { "accept-encoding": "br" })).json()) as {
      messages: unknown[];
    };
    expect(body.messages).toHaveLength(25);
  });

  test("an empty chat is page 0 with no messages", async () => {
    total = 0;
    const body = (await (await get("ses_1")).json()) as { page: number; messages: unknown[] };
    expect(body).toEqual({ page: 0, messages: [] });
    total = 60;
  });

  test("core's answer for an unknown chat or a missing login passes through, and credentials are forwarded", async () => {
    expect((await get("ses_missing")).status).toBe(404);
    const anon = await fetch(`${server.url}/ui/messages/ses_1`);
    expect(anon.status).toBe(401);
    seen.length = 0;
    await get("ses_1", { authorization: "Bearer t" });
    expect(seen.at(-1)?.headers.get("cookie")).toBe("a=b");
    expect(seen.at(-1)?.headers.get("authorization")).toBe("Bearer t");
  });

  test("rejects bad page numbers and foreign origins", async () => {
    for (const bad of ["-1", "1.5", "abc"]) expect((await get(`ses_1?page=${bad}`)).status).toBe(400);
    const res = await get("ses_1", { origin: "http://evil.example" });
    expect(res.status).toBe(403);
  });
});
