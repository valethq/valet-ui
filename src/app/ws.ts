import type { ClientFrame, ServerFrame } from "./types";

const PING_MS = 10_000;
const STALE_MS = 25_000;
const MAX_BACKOFF_MS = 5_000;

/** Records the last seen seq for `topic`; returns true when the frame skipped
 * seqs — the caller still delivers it, then refetches (onGap). */
export function trackSeq(seqs: Map<string, number>, topic: string, seq: number): boolean {
  const last = seqs.get(topic);
  if (last === undefined || seq > last) seqs.set(topic, seq);
  return last !== undefined && seq > last + 1;
}

/** A socket is stale once nothing has arrived for STALE_MS — a dead network
 * leaves the ws looking open, so silence is the only liveness signal. */
export function heartbeatStale(lastFrameAt: number, now: number): boolean {
  return now - lastFrameAt >= STALE_MS;
}

/** The /ws multiplexed protocol (10.3): sub/unsub, per-topic seq resume via
 * `since`, `gap` -> caller refetches over REST, reconnect with backoff. */
export class CoreSocket {
  onEvent: (topic: string, name: string, data: unknown) => void = () => {};
  onGap: (topic: string) => void = () => {};
  onDenied: (topic: string, message: string) => void = () => {};
  onState: (open: boolean) => void = () => {};
  /** Close code 4401: the socket's principal is gone (logged out). */
  onUnauthorized: () => void = () => {};

  readonly #url: string;
  readonly #wanted = new Set<string>();
  readonly #seqs = new Map<string, number>();
  #ws: WebSocket | undefined;
  #backoff = 500;
  #closed = false;
  #lastFrame = 0;
  #ping: ReturnType<typeof setInterval> | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;

  constructor(coreUrl: string) {
    this.#url = `${coreUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/ws`;
  }

  start(): void {
    this.#closed = false;
    window.addEventListener("offline", this.#offline);
    window.addEventListener("online", this.#online);
    this.#connect();
  }

  get open(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.#closed = true;
    window.removeEventListener("offline", this.#offline);
    window.removeEventListener("online", this.#online);
    this.#clearPing();
    this.#clearRetry();
    this.#dropSocket();
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

  readonly #offline = (): void => {
    // The network is gone; drop now rather than waiting out the heartbeat.
    if (this.#closed) return;
    this.onState(false);
    this.#clearPing();
    this.#dropSocket();
    this.#retrySoon();
  };

  readonly #online = (): void => {
    // Connectivity is back: retry now rather than waiting out the backoff.
    if (this.#closed) return;
    this.#clearPing();
    this.#clearRetry();
    this.#dropSocket();
    this.#connect();
  };

  #connect(): void {
    const ws = new WebSocket(this.#url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#backoff = 500;
      this.#lastFrame = Date.now();
      this.onState(true);
      this.#subscribe([...this.#wanted]);
      this.#ping = setInterval(() => this.#beat(), PING_MS);
    };
    ws.onmessage = (ev) => {
      this.#lastFrame = Date.now();
      this.#onFrame(ev.data as string);
    };
    ws.onclose = (ev) => {
      this.#clearPing();
      this.onState(false);
      if (ev.code === 4401) {
        this.#closed = true;
        this.onUnauthorized();
        return;
      }
      this.#retrySoon();
    };
  }

  #beat(): void {
    if (heartbeatStale(this.#lastFrame, Date.now())) {
      this.onState(false);
      this.#clearPing();
      this.#dropSocket();
      this.#retrySoon();
      return;
    }
    this.#send({ type: "ping" });
  }

  /** Detach and close the current socket, if any — its onclose would race the
   * retry path otherwise. */
  #dropSocket(): void {
    const ws = this.#ws;
    this.#ws = undefined;
    if (ws === undefined) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    ws.close();
  }

  #clearPing(): void {
    if (this.#ping !== undefined) clearInterval(this.#ping);
    this.#ping = undefined;
  }

  #clearRetry(): void {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
  }

  #retrySoon(): void {
    if (this.#closed || this.#retry !== undefined) return;
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      this.#connect();
    }, this.#backoff);
    this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
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
      case "event": {
        const skipped = trackSeq(this.#seqs, frame.topic, frame.seq);
        this.onEvent(frame.topic, frame.name, frame.data);
        if (skipped) this.onGap(frame.topic);
        return;
      }
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
