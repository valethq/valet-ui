import type { ClientFrame, ServerFrame } from "./types";

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 5_000;

/** The /ws multiplexed protocol (10.3): sub/unsub, per-topic seq resume via
 * `since`, `gap` -> caller refetches over REST, reconnect with backoff. */
export class CoreSocket {
  onEvent: (topic: string, name: string, data: unknown) => void = () => {};
  onGap: (topic: string) => void = () => {};
  onDenied: (topic: string, message: string) => void = () => {};

  readonly #url: string;
  readonly #wanted = new Set<string>();
  readonly #seqs = new Map<string, number>();
  #ws: WebSocket | undefined;
  #backoff = 500;
  #closed = false;
  #ping: ReturnType<typeof setInterval> | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;

  constructor(coreUrl: string) {
    this.#url = `${coreUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/ws`;
  }

  start(): void {
    this.#closed = false;
    this.#connect();
  }

  close(): void {
    this.#closed = true;
    if (this.#ping !== undefined) clearInterval(this.#ping);
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#ws?.close();
  }

  /** Diff-subscribe: subs new topics (with `since` when known), unsubs removed. */
  setTopics(topics: string[]): void {
    const next = new Set(topics);
    const removed = [...this.#wanted].filter((t) => !next.has(t));
    this.#wanted.clear();
    for (const t of next) this.#wanted.add(t);
    if (removed.length > 0) this.#send({ type: "unsub", topics: removed });
    this.#subscribe([...next]);
  }

  #connect(): void {
    const ws = new WebSocket(this.#url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#backoff = 500;
      this.#subscribe([...this.#wanted]);
      this.#ping = setInterval(() => this.#send({ type: "ping" }), PING_MS);
    };
    ws.onmessage = (ev) => this.#onFrame(ev.data as string);
    ws.onclose = () => {
      if (this.#ping !== undefined) clearInterval(this.#ping);
      if (!this.#closed) {
        this.#retry = setTimeout(() => this.#connect(), this.#backoff);
        this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
      }
    };
  }

  #subscribe(topics: string[]): void {
    if (topics.length === 0) return;
    const since: Record<string, number> = {};
    for (const t of topics) {
      const seq = this.#seqs.get(t);
      if (seq !== undefined) since[t] = seq;
    }
    this.#send({ type: "sub", topics, ...(Object.keys(since).length === 0 ? {} : { since }) });
  }

  #send(frame: ClientFrame): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(frame));
  }

  #onFrame(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.type) {
      case "event":
        this.#seqs.set(frame.topic, frame.seq);
        this.onEvent(frame.topic, frame.name, frame.data);
        return;
      case "gap":
        this.#seqs.delete(frame.topic);
        this.onGap(frame.topic);
        return;
      case "result":
        if (!frame.ok && frame.error?.code === "denied") {
          this.onDenied(frame.id, frame.error.message);
        }
        return;
      default:
        return;
    }
  }
}
