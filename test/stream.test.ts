import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { startUiServer, type UiServer } from "../src/server";

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

async function until(ok: () => boolean, ms = 1500): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await Bun.sleep(20);
  }
}

describe("vnc stream endpoints", () => {
  let rfb: Server;
  let rfbPort: number;
  let ui: UiServer;
  const sockets = new Set<Socket>();
  const received: Buffer[] = [];

  beforeAll(async () => {
    rfb = createServer((socket) => {
      sockets.add(socket);
      socket.write("RFB 003.008\n");
      socket.on("data", (chunk) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received.push(data);
        socket.write(Buffer.concat([Buffer.from("echo:"), data]));
      });
      socket.on("close", () => sockets.delete(socket));
    });
    await listen(rfb);
    rfbPort = (rfb.address() as { port: number }).port;
    ui = await startUiServer({ port: 0, authorizeStream: () => true });
  });

  afterAll(async () => {
    ui.stop();
    for (const socket of sockets) socket.destroy();
    await close(rfb);
  });

  test("probe knocks and reports the RFB version when somebody is home", async () => {
    const res = await fetch(`${ui.url}/stream/vnc/probe?host=127.0.0.1&port=${rfbPort}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "003.008" });
  });

  test("probe reports away for a closed port and rejects non-loopback targets", async () => {
    const away = await fetch(`${ui.url}/stream/vnc/probe?host=127.0.0.1&port=1`);
    expect(away.status).toBe(200);
    expect((await away.json()).ok).toBe(false);
    const remote = await fetch(`${ui.url}/stream/vnc/probe?host=example.com&port=5900`);
    expect(remote.status).toBe(400);
  });

  test("streams fail closed without an authorizer", async () => {
    const denied = await startUiServer({ port: 0 });
    try {
      const res = await fetch(`${denied.url}/stream/vnc/probe?host=127.0.0.1&port=${rfbPort}`);
      expect(res.status).toBe(403);
    } finally {
      denied.stop();
    }
  });

  test("the websocket bridges binary stream bytes after validating RFB", async () => {
    received.length = 0;
    const ws = new WebSocket(`${ui.url.replace(/^http/, "ws")}/stream/vnc?host=127.0.0.1&port=${rfbPort}`);
    const frames: Buffer[] = [];
    const closed = new Promise<number>((resolve) => {
      ws.onclose = (ev) => resolve(ev.code);
    });
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") frames.push(Buffer.from(ev.data as ArrayBuffer));
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("websocket failed"));
    });
    await until(() => frames.some((f) => f.subarray(0, 12).toString("ascii") === "RFB 003.008\n"));
    ws.send(new Uint8Array([1, 2, 3]));
    await until(() => received.some((f) => f.includes(Buffer.from([1, 2, 3]))));
    await until(() => frames.some((f) => f.includes(Buffer.from("echo:"))));
    ws.close();
    expect(await closed).toBeLessThan(1011);
  });
});
