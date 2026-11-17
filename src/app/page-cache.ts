import type { ChatMessage } from "./types";

export interface CachedPage {
  etag: string;
  page: number;
  messages: ChatMessage[];
}

/** Message pages kept on this device, keyed `<sessionId>:<page|tail>`. Every method swallows storage errors
 * (private mode, quota): a broken cache is a cache miss. */
export interface PageStore {
  get(key: string): Promise<CachedPage | undefined>;
  put(key: string, page: CachedPage): Promise<void>;
  /** Drops every page of one chat. */
  drop(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): PageStore {
  const map = new Map<string, CachedPage>();
  // Copies in and out, so a view that fills its pages in never edits what the cache holds.
  return {
    get: async (key) => {
      const hit = map.get(key);
      return hit === undefined ? undefined : structuredClone(hit);
    },
    put: async (key, page) => {
      map.set(key, structuredClone(page));
    },
    drop: async (sessionId) => {
      for (const key of [...map.keys()]) if (key.startsWith(`${sessionId}:`)) map.delete(key);
    },
    clear: async () => map.clear(),
  };
}

const DB_NAME = "valet-ui";
const STORE = "pages";
/** About 100 KB a page, so this stays near 30 MB; the least recently written go first. */
const MAX_PAGES = 300;

const wait = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

function openDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE).createIndex("at", "at");
  };
  return wait(request);
}

async function evict(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  let excess = (await wait(store.count())) - MAX_PAGES;
  if (excess <= 0) return;
  const cursor = store.index("at").openKeyCursor();
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (at === null || excess-- <= 0) return;
    store.delete(at.primaryKey);
    at.continue();
  };
  await finished(tx);
}

export function indexedDbStore(): PageStore {
  const db = openDb();
  db.catch(() => {});
  const run = async <T>(fn: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn(await db);
    } catch {
      return fallback;
    }
  };
  return {
    get: (key) =>
      run(async (d) => {
        const row = (await wait(d.transaction(STORE).objectStore(STORE).get(key))) as
          | (CachedPage & { at: number })
          | undefined;
        return row === undefined ? undefined : { etag: row.etag, page: row.page, messages: row.messages };
      }, undefined),
    put: (key, page) =>
      run(async (d) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ ...page, at: Date.now() }, key);
        await finished(tx);
        await evict(d);
      }, undefined),
    drop: (sessionId) =>
      run(async (d) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(IDBKeyRange.bound(`${sessionId}:`, `${sessionId}:￿`));
        await finished(tx);
      }, undefined),
    clear: () =>
      run(async (d) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        await finished(tx);
      }, undefined),
  };
}

/** IndexedDB when the browser has it, otherwise a cache that lasts until reload. */
export const defaultStore = (): PageStore =>
  typeof indexedDB === "undefined" ? memoryStore() : indexedDbStore();
