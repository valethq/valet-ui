import RFB from "@novnc/novnc";
import { vncPath, type VncRef } from "../vnc";
import { el } from "./dom";

export type StreamConnection = "connecting" | "connected" | "disconnected" | "failed";

export interface StreamState {
  connection: StreamConnection;
  text: string;
}

export interface StreamView {
  node: HTMLElement;
  close(): void;
}

/** A view-only noVNC client mounted in the file viewer. */
export function createVncView(ref: VncRef, onState: (state: StreamState) => void): StreamView {
  const target = el("div", { class: "fv-vnc-target" });
  const note = el("div", { class: "fv-vnc-note", text: "Connecting…" });
  const node = el("div", { class: "fv-vnc" }, target, note);
  let closed = false;
  let rfb: RFB | undefined;

  const state = (connection: StreamConnection, text: string): void => {
    note.hidden = connection === "connected";
    note.textContent = text;
    onState({ connection, text });
  };
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${window.location.host}${vncPath(ref)}`;

  try {
    rfb = new RFB(target, url, { shared: true });
    rfb.viewOnly = true;
    rfb.focusOnClick = false;
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.resizeSession = false;
    rfb.addEventListener("connect", () => state("connected", "Connected"));
    rfb.addEventListener("securityfailure", (ev) => {
      if (!closed) state("failed", ev.detail?.reason ?? "VNC security negotiation failed");
    });
    rfb.addEventListener("disconnect", (ev) => {
      if (closed) return;
      if (ev.detail?.clean === true) state("disconnected", "Stream disconnected");
      else state("failed", "Stream unavailable — nobody home");
    });
    state("connecting", "Connecting…");
  } catch (error) {
    state("failed", error instanceof Error ? error.message : "Couldn't start the stream");
  }

  return {
    node,
    close() {
      closed = true;
      try {
        rfb?.disconnect();
      } catch {
        // teardown is best-effort
      }
    },
  };
}
