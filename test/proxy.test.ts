import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startUiServer, type UiServer } from "../src/server";

interface Seen {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

describe("core relay", () => {
  let core: ReturnType<typeof Bun.serve>;
  let ui: UiServer;
  let seen: Seen;
  let socketHeaders: Headers;
  let upstreamFrames: string[];

  beforeAll(async () => {
    upstreamFrames = [];
    core = Bun.serve<undefined>({
      port: 0,
      async fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          socketHeaders = req.headers;
          if (req.headers.get("cookie") !== "sid=ok") return new Response("no", { status: 401 });
          return srv.upgrade(req) ? undefined : new Response("upgrade", { status: 400 });
        }
        seen = {
          method: req.method,
          path: url.pathname + url.search,
          headers: req.headers,
          body: await req.text(),
        };
        if (url.pathname === "/plugins/valet-auth/login") {
          return Response.json({ ok: true }, { headers: { "set-cookie": "sid=ok; HttpOnly; Path=/" } });
        }
        if (url.pathname === "/api/core/missing") return Response.json({ error: "nope" }, { status: 404 });
        return Response.json({ ok: true });
      },
      websocket: {
        message(ws, frame) {
          upstreamFrames.push(String(frame));
          if (String(frame) === "bye") ws.close(4401, "unauthenticated");
          else ws.send(`echo:${String(frame)}`);
        },
      },
    });
    ui = await startUiServer({ port: 0, coreUrl: `http://127.0.0.1:${core.port}` });
  });
  afterAll(() => {
    ui.stop();
    core.stop(true);
  });

  test("relays method, path, query, body and cookie, and returns status and body", async () => {
    const res = await fetch(`${ui.url}/api/core/sessions?projectId=p1`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sid=ok" },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen.method).toBe("POST");
    expect(seen.path).toBe("/api/core/sessions?projectId=p1");
    expect(seen.body).toBe('{"a":1}');
    expect(seen.headers.get("cookie")).toBe("sid=ok");
  });

  test("passes error statuses and set-cookie back to the browser", async () => {
    expect((await fetch(`${ui.url}/api/core/missing`)).status).toBe(404);
    const login = await fetch(`${ui.url}/plugins/valet-auth/login`, { method: "POST", body: "{}" });
    expect(login.headers.get("set-cookie")).toBe("sid=ok; HttpOnly; Path=/");
  });

  test("the browser's own origin is not forwarded, a foreign one is refused", async () => {
    const same = new URL(ui.url).host;
    const ok = await fetch(`${ui.url}/api/core/x`, { method: "PUT", headers: { origin: `http://${same}` } });
    expect(ok.status).toBe(200);
    expect(seen.headers.get("origin")).toBeNull();
    const evil = await fetch(`${ui.url}/api/core/x`, {
      method: "POST",
      headers: { origin: "http://evil.test" },
    });
    expect(evil.status).toBe(403);
  });

  test("only api, plugins and ws are relayed", async () => {
    expect((await fetch(`${ui.url}/health`)).status).toBe(404);
    expect((await fetch(`${ui.url}/apix`)).status).toBe(404);
  });

  test("an unreachable core is a 502", async () => {
    const dead = await startUiServer({ port: 0, coreUrl: "http://127.0.0.1:1" });
    try {
      const res = await fetch(`${dead.url}/api/core/projects`);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Server unreachable" });
    } finally {
      dead.stop();
    }
  });

  const open = (url: string, headers?: Record<string, string>) =>
    new Promise<{ ws: WebSocket; frames: string[]; closed: Promise<number> }>((resolve, reject) => {
      const ws = new (WebSocket as unknown as new (u: string, o?: unknown) => WebSocket)(
        `${url.replace(/^http/, "ws")}/ws`,
        { headers },
      );
      const frames: string[] = [];
      const closed = new Promise<number>((r) => {
        ws.onclose = (ev) => r(ev.code);
      });
      ws.onmessage = (ev) => frames.push(String(ev.data));
      ws.onopen = () => resolve({ ws, frames, closed });
      ws.onerror = () => reject(new Error("ws failed"));
    });

  test("relays websocket frames both ways with the browser's cookie", async () => {
    const { ws, frames } = await open(ui.url, { cookie: "sid=ok" });
    ws.send("hello");
    await Bun.sleep(100);
    expect(upstreamFrames).toContain("hello");
    expect(frames).toEqual(["echo:hello"]);
    expect(socketHeaders.get("cookie")).toBe("sid=ok");
    ws.close();
  });

  test("passes core's close code (4401) through to the browser", async () => {
    const { ws, closed } = await open(ui.url, { cookie: "sid=ok" });
    ws.send("bye");
    expect(await closed).toBe(4401);
  });

  test("a socket core refuses is closed rather than left dangling", async () => {
    const { closed } = await open(ui.url);
    expect(await closed).toBe(1011);
  });
});
