import type { PageResult } from "./api";
import type { PageStore } from "./page-cache";
import type { ChatMessage } from "./types";

export interface Loaded {
  page: number;
  messages: ChatMessage[];
  /** The page's ETag; rounds of its remaining pieces are asked for against it. */
  etag: string;
}

/** Loads chat pages through the device cache: a cached copy is handed over at once (`onCached`), then the
 * server confirms it with a conditional request (304, nothing re-sent) or replaces it. */
export function createPageLoader(
  store: PageStore,
  fetchPage: (sessionId: string, which: number | "tail", etag?: string) => Promise<PageResult>,
) {
  return {
    async load(
      sessionId: string,
      which: number | "tail",
      onCached?: (cached: Loaded) => void,
    ): Promise<Loaded> {
      const cached = await store.get(`${sessionId}:${which}`);
      if (cached !== undefined) onCached?.(cached);
      const res = await fetchPage(sessionId, which, cached?.etag);
      if (res.status === 304) {
        if (cached === undefined) throw new Error("304 without a cached copy");
        return cached;
      }
      const record = { etag: res.etag, page: res.page, messages: res.messages };
      await Promise.all([
        store.put(`${sessionId}:${res.page}`, record),
        which === "tail" ? store.put(`${sessionId}:tail`, record) : undefined,
      ]);
      return record;
    },
    /** Stores a page once every piece has arrived. The tail copy is only touched while it still is this page. */
    async save(sessionId: string, loaded: Loaded, tail: boolean): Promise<void> {
      await store.put(`${sessionId}:${loaded.page}`, loaded);
      if (tail && (await store.get(`${sessionId}:tail`))?.page === loaded.page) {
        await store.put(`${sessionId}:tail`, loaded);
      }
    },
    drop: (sessionId: string) => store.drop(sessionId),
    clear: () => store.clear(),
  };
}

export type PageLoader = ReturnType<typeof createPageLoader>;
