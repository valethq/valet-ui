import { describe, expect, test } from "bun:test";
import type { PageResult } from "../src/app/api";
import { createPageLoader } from "../src/app/chat-pages";
import { memoryStore } from "../src/app/page-cache";
import type { ChatMessage } from "../src/app/types";

const msgs = (...seqs: number[]): ChatMessage[] =>
  seqs.map((seq) => ({ message: { id: `m${seq}`, seq }, parts: [] }) as unknown as ChatMessage);

function setup() {
  const store = memoryStore();
  const calls: { which: number | "tail"; etag?: string }[] = [];
  let next: PageResult = { status: 200, page: 2, messages: msgs(51, 52), etag: '"a"' };
  const loader = createPageLoader(store, async (_sid, which, etag) => {
    calls.push({ which, ...(etag === undefined ? {} : { etag }) });
    if (next instanceof Error) throw next;
    return next;
  });
  return { store, calls, loader, reply: (r: PageResult) => (next = r) };
}

describe("page loader", () => {
  test("a cold load fetches without a validator and caches under the page and the tail", async () => {
    const t = setup();
    const got = await t.loader.load("s", "tail");
    expect(got.page).toBe(2);
    expect(t.calls).toEqual([{ which: "tail" }]);
    expect((await t.store.get("s:2"))?.etag).toBe('"a"');
    expect((await t.store.get("s:tail"))?.page).toBe(2);
  });

  test("a warm load hands over the cached copy first, then settles on a 304 without a rewrite", async () => {
    const t = setup();
    await t.loader.load("s", "tail");
    t.reply({ status: 304 });
    const painted: number[][] = [];
    const got = await t.loader.load("s", "tail", (c) => painted.push(c.messages.map((m) => m.message.seq)));
    expect(painted).toEqual([[51, 52]]);
    expect(got.messages.map((m) => m.message.seq)).toEqual([51, 52]);
    expect(t.calls.at(-1)).toEqual({ which: "tail", etag: '"a"' });
  });

  test("a changed page replaces the cached one", async () => {
    const t = setup();
    await t.loader.load("s", 2);
    t.reply({ status: 200, page: 2, messages: msgs(51, 52, 53), etag: '"b"' });
    const got = await t.loader.load("s", 2);
    expect(got.messages).toHaveLength(3);
    expect((await t.store.get("s:2"))?.etag).toBe('"b"');
    expect(await t.store.get("s:tail")).toBeUndefined();
  });

  test("when the tail rolls to a new page the old page stays cached under its own key", async () => {
    const t = setup();
    await t.loader.load("s", "tail");
    t.reply({ status: 200, page: 3, messages: msgs(76), etag: '"c"' });
    expect((await t.loader.load("s", "tail")).page).toBe(3);
    expect((await t.store.get("s:2"))?.messages).toHaveLength(2);
    expect((await t.store.get("s:tail"))?.page).toBe(3);
  });

  test("a 304 with nothing cached is an error, and fetch errors reach the caller after the cached paint", async () => {
    const t = setup();
    t.reply({ status: 304 });
    await expect(t.loader.load("s", 5)).rejects.toThrow("304");
    const warm = setup();
    await warm.loader.load("s", "tail");
    warm.reply(new Error("offline") as unknown as PageResult);
    const painted: number[] = [];
    await expect(warm.loader.load("s", "tail", (c) => painted.push(c.page))).rejects.toThrow("offline");
    expect(painted).toEqual([2]);
  });

  test("the loader hands back the etag, and save stores a finished page without moving the tail", async () => {
    const t = setup();
    const got = await t.loader.load("s", "tail");
    expect(got.etag).toBe('"a"');
    const filled = { ...got, messages: msgs(51, 52, 53) };
    await t.loader.save("s", filled, true);
    expect((await t.store.get("s:2"))?.messages).toHaveLength(3);
    expect((await t.store.get("s:tail"))?.messages).toHaveLength(3);
    t.reply({ status: 200, page: 3, messages: msgs(76), etag: '"c"' });
    await t.loader.load("s", "tail");
    await t.loader.save("s", { ...filled, messages: msgs(51, 52, 53, 54) }, true);
    expect((await t.store.get("s:2"))?.messages).toHaveLength(4);
    expect((await t.store.get("s:tail"))?.page).toBe(3);
  });

  test("a cached copy is not the same object the view edits", async () => {
    const t = setup();
    const got = await t.loader.load("s", 2);
    got.messages.length = 0;
    expect((await t.store.get("s:2"))?.messages).toHaveLength(2);
  });

  test("drop removes one chat's pages and leaves the others", async () => {
    const t = setup();
    await t.loader.load("s", "tail");
    await t.loader.load("other", "tail");
    await t.loader.drop("s");
    expect(await t.store.get("s:2")).toBeUndefined();
    expect(await t.store.get("s:tail")).toBeUndefined();
    expect(await t.store.get("other:2")).toBeDefined();
    await t.loader.clear();
    expect(await t.store.get("other:2")).toBeUndefined();
  });
});
