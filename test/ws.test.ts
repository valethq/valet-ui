import { describe, expect, test } from "bun:test";
import { CoreSocket, heartbeatStale, trackSeq } from "../src/app/ws";

describe("trackSeq", () => {
  test("the first frame for a topic is not a gap", () => {
    const seqs = new Map<string, number>();
    expect(trackSeq(seqs, "t", 1)).toBe(false);
    expect(trackSeq(seqs, "t", 7)).toBe(true);
    expect(seqs.get("t")).toBe(7);
  });

  test("consecutive seqs are not a gap", () => {
    const seqs = new Map<string, number>();
    expect(trackSeq(seqs, "t", 1)).toBe(false);
    expect(trackSeq(seqs, "t", 2)).toBe(false);
    expect(trackSeq(seqs, "t", 3)).toBe(false);
  });

  test("a skipped seq reports a gap once, then resumes", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "t", 1);
    expect(trackSeq(seqs, "t", 4)).toBe(true);
    expect(trackSeq(seqs, "t", 5)).toBe(false);
  });

  test("gaps are tracked per topic", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "a", 1);
    trackSeq(seqs, "b", 10);
    expect(trackSeq(seqs, "a", 3)).toBe(true);
    expect(trackSeq(seqs, "b", 11)).toBe(false);
  });

  test("a late or replayed frame is not a gap and does not rewind", () => {
    const seqs = new Map<string, number>();
    trackSeq(seqs, "t", 5);
    expect(trackSeq(seqs, "t", 3)).toBe(false);
    expect(trackSeq(seqs, "t", 5)).toBe(false);
    expect(trackSeq(seqs, "t", 6)).toBe(false);
    expect(seqs.get("t")).toBe(6);
  });
});

describe("heartbeatStale", () => {
  test("a frame inside the window keeps the socket alive", () => {
    expect(heartbeatStale(10_000, 10_000)).toBe(false);
    expect(heartbeatStale(10_000, 17_999)).toBe(false);
  });

  test("8s of silence is stale", () => {
    expect(heartbeatStale(10_000, 18_000)).toBe(true);
    expect(heartbeatStale(0, 8_000)).toBe(true);
  });
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

describe("isLive", () => {
  test("false while connecting, true once open, false once the heartbeat goes silent", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, WebSocket: g.WebSocket, now: Date.now };
    let now = 1_000_000;
    try {
      Date.now = () => now;
      FakeWebSocket.instances = [];
      g.window = { addEventListener() {}, removeEventListener() {} };
      g.WebSocket = FakeWebSocket;

      const sock = new CoreSocket("http://core.test");
      expect(sock.isLive()).toBe(false);
      sock.start();
      const ws = FakeWebSocket.instances[0] as FakeWebSocket;
      expect(sock.isLive()).toBe(false);
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.();
      expect(sock.isLive()).toBe(true);
      now += 7_999;
      expect(sock.isLive()).toBe(true);
      now += 1;
      expect(sock.isLive()).toBe(false);
      sock.close();
    } finally {
      g.window = saved.window;
      g.WebSocket = saved.WebSocket;
      Date.now = saved.now;
    }
  });

  test("a fresh frame revives a nearly-stale socket", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, WebSocket: g.WebSocket, now: Date.now };
    let now = 1_000_000;
    try {
      Date.now = () => now;
      FakeWebSocket.instances = [];
      g.window = { addEventListener() {}, removeEventListener() {} };
      g.WebSocket = FakeWebSocket;

      const sock = new CoreSocket("http://core.test");
      sock.start();
      const ws = FakeWebSocket.instances[0] as FakeWebSocket;
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.();
      now += 7_999;
      ws.onmessage?.({ data: '{"type":"pong"}' });
      expect(sock.isLive()).toBe(true);
      now += 8_000;
      expect(sock.isLive()).toBe(false);
      sock.close();
    } finally {
      g.window = saved.window;
      g.WebSocket = saved.WebSocket;
      Date.now = saved.now;
    }
  });
});

describe("connect timeout", () => {
  test("a socket stuck CONNECTING is dropped after 5s and the next one goes live", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      window: g.window,
      WebSocket: g.WebSocket,
      setTimeout: g.setTimeout,
      clearTimeout: g.clearTimeout,
    };
    const timers = new Map<number, () => void>();
    let nextId = 1;
    try {
      FakeWebSocket.instances = [];
      g.window = { addEventListener() {}, removeEventListener() {} };
      g.WebSocket = FakeWebSocket;
      g.setTimeout = (cb: () => void) => {
        const id = nextId++;
        timers.set(id, cb);
        return id;
      };
      g.clearTimeout = (id: number) => {
        timers.delete(id);
      };
      const fireAll = () => {
        for (const [id, cb] of [...timers]) {
          timers.delete(id);
          cb();
        }
      };

      const states: boolean[] = [];
      const sock = new CoreSocket("http://core.test");
      sock.onState = (open) => {
        states.push(open);
      };
      sock.start();
      expect(FakeWebSocket.instances.length).toBe(1);
      expect(timers.size).toBe(1);

      // The connect timer fires while the socket is still CONNECTING: it is
      // dropped and a retry is scheduled on the normal backoff.
      fireAll();
      expect((FakeWebSocket.instances[0] as FakeWebSocket).readyState).toBe(3);
      expect(timers.size).toBe(1);
      expect(states).toEqual([]);

      // The retry connects a fresh socket; when it opens, state goes live.
      fireAll();
      expect(FakeWebSocket.instances.length).toBe(2);
      const ws = FakeWebSocket.instances[1] as FakeWebSocket;
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.();
      expect(states).toEqual([true]);
      expect(sock.open).toBe(true);
      expect(timers.size).toBe(0);
      sock.close();
    } finally {
      g.window = saved.window;
      g.WebSocket = saved.WebSocket;
      g.setTimeout = saved.setTimeout;
      g.clearTimeout = saved.clearTimeout;
    }
  });
});
