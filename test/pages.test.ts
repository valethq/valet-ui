import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chunkConfig, DEFAULT_CHUNK, pageOf, roundBudget } from "../src/paging";
import { pagingFor } from "../src/app/state";
import { startUiServer, type UiServer } from "../src/server";

describe("pageOf", () => {
  test("seqs start at 1 and fill a page before the next begins", () => {
    expect(DEFAULT_CHUNK.chunkMessages).toBe(25);
    expect([0, 1, 25, 26, 50, 51].map((s) => pageOf(s, 25))).toEqual([0, 0, 0, 1, 1, 2]);
    expect([1, 10, 11, 20, 21].map((s) => pageOf(s, 10))).toEqual([0, 0, 1, 1, 2]);
  });

  test("config falls back to defaults for junk and clamps to sane bounds", () => {
    expect(chunkConfig()).toEqual(DEFAULT_CHUNK);
    expect(chunkConfig({ chunkMessages: 1.5, partChars: Number.NaN })).toEqual(DEFAULT_CHUNK);
    expect(chunkConfig({ chunkMessages: 1, partChars: 10 })).toEqual({ chunkMessages: 5, partChars: 500 });
    expect(chunkConfig({ chunkMessages: 9999, partChars: 9e9 })).toEqual({
      chunkMessages: 100,
      partChars: 200_000,
    });
  });

  test("a round may send one full-size part for each message in a page", () => {
    expect(roundBudget(DEFAULT_CHUNK)).toBe(25 * 8_000);
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

describe("/ui/messages rounds", () => {
  let core: ReturnType<typeof Bun.serve>;
  let server: UiServer;
  let said = "s".repeat(1800);
  let streaming = false;
  const tool = "t".repeat(3000);

  const typed = (seq: number) => ({
    message: {
      id: `msg_${seq}`,
      seq,
      sessionId: "ses_1",
      status: streaming && seq === 10 ? "streaming" : "complete",
    },
    parts:
      seq === 10
        ? [
            {
              id: "prt_tool",
              type: "tool-call",
              status: "complete",
              data: { type: "tool-call", name: "exec", input: {}, output: tool, status: "done" },
            },
            { id: "prt_said", type: "text", status: "complete", data: { type: "text", text: said } },
          ]
        : [{ id: `prt_${seq}`, type: "text", status: "complete", data: { type: "text", text: "hi" } }],
  });

  beforeAll(async () => {
    core = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const before = Number(url.searchParams.get("beforeSeq") ?? 11);
        const limit = Number(url.searchParams.get("limit") ?? 10);
        const seqs = Array.from({ length: 10 }, (_, i) => i + 1)
          .filter((s) => s < before)
          .slice(-limit);
        return Response.json(seqs.map(typed));
      },
    });
    server = await startUiServer({
      port: 0,
      coreUrl: `http://127.0.0.1:${core.port}`,
      chunkMessages: 5,
      partChars: 500,
    });
  });
  afterAll(() => {
    server.stop();
    core.stop(true);
  });

  type Body = {
    page: number;
    messages: { parts: { id: string; partial?: number; data: { text?: string; output?: string } }[] }[];
  };
  const get = (q: string) => fetch(`${server.url}/ui/messages/ses_1${q}`, { headers: { cookie: "a=b" } });

  test("the first round cuts long parts to a piece, says how long they are, and keeps text ahead of output", async () => {
    const body = (await (await get("")).json()) as Body;
    expect(body.page).toBe(1);
    const parts = Object.fromEntries(body.messages.flatMap((m) => m.parts).map((p) => [p.id, p]));
    expect(parts.prt_said?.data.text).toHaveLength(500);
    expect(parts.prt_said?.partial).toBe(1800);
    // budget is 5 x 500; the model's text and the short parts take 500 + 4 x 2 first
    expect(parts.prt_tool?.data.output?.length).toBeLessThanOrEqual(2500 - 500 - 8);
    expect(parts.prt_tool?.partial).toBe(3000);
    expect(parts.prt_6?.partial).toBeUndefined();
  });

  test("the rounds rebuild every part, each validated against the page's etag", async () => {
    const first = await get("?page=1");
    const etag = first.headers.get("etag") as string;
    const body = (await first.json()) as Body;
    const text = new Map(
      body.messages.flatMap((m) => m.parts).map((p) => [p.id, p.data.text ?? p.data.output ?? ""]),
    );
    let done = false;
    for (let round = 1; round < 20 && !done; round++) {
      const res = await get(`?page=1&round=${round}&v=${encodeURIComponent(etag)}`);
      expect(res.status).toBe(200);
      const r = (await res.json()) as { pieces: { id: string; at: number; text: string }[]; done: boolean };
      for (const p of r.pieces) {
        expect(p.at).toBe(text.get(p.id)?.length as number);
        text.set(p.id, (text.get(p.id) as string) + p.text);
      }
      done = r.done;
    }
    expect(done).toBe(true);
    expect(text.get("prt_said")).toBe(said);
    expect(text.get("prt_tool")).toBe(tool);
  });

  test("a round answers 409 once the page has changed, and 400 without a page", async () => {
    const etag = (await get("?page=1")).headers.get("etag") as string;
    said = "edited ".repeat(300);
    expect((await get(`?page=1&round=1&v=${encodeURIComponent(etag)}`)).status).toBe(409);
    expect((await get("?page=1&round=1&v=nope")).status).toBe(409);
    expect((await get(`?round=1&v=${encodeURIComponent(etag)}`)).status).toBe(400);
    expect((await get("?page=1&round=0")).status).toBe(400);
    said = "s".repeat(1800);
  });

  test("the weak etag the browser sends back after compression still validates a round", async () => {
    const res = await get("?page=1");
    const weak = `W/${res.headers.get("etag")?.replace(/^W\//, "")}`;
    expect((await get(`?page=1&round=1&v=${encodeURIComponent(weak)}`)).status).toBe(200);
  });

  test("a message still streaming is sent whole", async () => {
    streaming = true;
    const body = (await (await get("")).json()) as Body;
    const parts = Object.fromEntries(body.messages.flatMap((m) => m.parts).map((p) => [p.id, p]));
    expect(parts.prt_said?.data.text).toHaveLength(1800);
    expect(parts.prt_said?.partial).toBeUndefined();
    expect(parts.prt_tool?.data.output).toHaveLength(3000);
    streaming = false;
  });
});
