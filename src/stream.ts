import { connect, type Socket } from "node:net";
import type { VncRef } from "./vnc";

export interface RfbConnection {
  socket: Socket;
  version: string;
  /** The greeting and any bytes that arrived in the same first read. */
  initial: Buffer;
}

const GREETING = /^RFB (\d{3}\.\d{3})\n/;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Connects to a TCP target and proves it is an RFB server before exposing it to a websocket client. */
export function connectRfb(target: VncRef, timeoutMs = 1500): Promise<RfbConnection> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => fail(new Error("timed out waiting for the RFB greeting")), timeoutMs);
    timer.unref();

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onClose = (): void => fail(new Error("connection closed before the RFB greeting"));
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes < 12) return;
      const initial = Buffer.concat(chunks);
      const match = GREETING.exec(initial.subarray(0, 12).toString("ascii"));
      if (match === null) {
        fail(new Error("target is not an RFB server"));
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      socket.setNoDelay(true);
      resolve({ socket, version: match[1] as string, initial });
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

export type VncProbe = { ok: true; version: string } | { ok: false; error: string };

/** The stream link's knock: connect, read the RFB greeting, and leave. */
export async function probeVnc(target: VncRef, timeoutMs = 700): Promise<VncProbe> {
  try {
    const conn = await connectRfb(target, timeoutMs);
    conn.socket.destroy();
    return { ok: true, version: conn.version };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export interface VncWsData {
  kind: "vnc";
  target: VncRef;
  socket?: Socket;
  pending: Buffer[];
  closed: boolean;
}

export const vncWsData = (target: VncRef): VncWsData => ({ kind: "vnc", target, pending: [], closed: false });

export const vncWsHandlers: Bun.WebSocketHandler<VncWsData> = {
  open(ws) {
    ws.binaryType = "nodebuffer";
    void connectRfb(ws.data.target)
      .then(({ socket, initial }) => {
        if (ws.data.closed || ws.readyState !== 1) {
          socket.destroy();
          return;
        }
        ws.data.socket = socket;
        let failed = false;
        socket.on("data", (chunk) => {
          if (ws.send(chunk) === -1) socket.pause();
        });
        socket.on("drain", () => ws.resume());
        socket.once("error", () => {
          failed = true;
          socket.destroy();
        });
        socket.once("close", () => {
          if (!ws.data.closed)
            ws.close(failed ? 1011 : 1000, failed ? "VNC connection failed" : "VNC connection closed");
        });
        ws.send(initial);
        for (const chunk of ws.data.pending.splice(0)) {
          if (!socket.write(chunk)) ws.pause();
        }
      })
      .catch(() => ws.close(1011, "VNC server unavailable"));
  },
  message(ws, frame) {
    const chunk = typeof frame === "string" ? Buffer.from(frame) : frame;
    const socket = ws.data.socket;
    if (socket === undefined) {
      ws.data.pending.push(chunk);
      if (ws.data.pending.reduce((n, b) => n + b.length, 0) > 65536)
        ws.close(1009, "too much queued stream input");
      return;
    }
    if (!socket.write(chunk)) ws.pause();
  },
  drain(ws) {
    ws.data.socket?.resume();
  },
  close(ws) {
    ws.data.closed = true;
    ws.data.socket?.destroy();
  },
};
