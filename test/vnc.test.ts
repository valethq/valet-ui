import { describe, expect, test } from "bun:test";
import { vncFromPath, vncKey, vncPath, vncProbePath, vncRef, vncTarget, vncUrl } from "../src/vnc";

describe("vnc refs", () => {
  test("parses loopback vnc links and normalizes them to IPv4 loopback", () => {
    expect(vncRef("vnc://127.0.0.1:5920")).toEqual({ kind: "vnc", host: "127.0.0.1", port: 5920 });
    expect(vncRef("vnc://localhost:5920")?.host).toBe("127.0.0.1");
    expect(vncRef("vnc://[::1]:5920")?.host).toBe("127.0.0.1");
    expect(vncRef("vnc://127.0.0.1")?.port).toBe(5900);
  });

  test("rejects non-loopback, credentialed, malformed and extra-path links", () => {
    expect(vncRef("vnc://example.com:5920")).toBeUndefined();
    expect(vncRef("vnc://user@127.0.0.1:5920")).toBeUndefined();
    expect(vncRef("vnc://127.0.0.1:5920/path")).toBeUndefined();
    expect(vncRef("https://127.0.0.1:5920")).toBeUndefined();
    expect(vncTarget("127.0.0.1", "0")).toBeUndefined();
    expect(vncTarget("127.0.0.1", "65536")).toBeUndefined();
  });

  test("formats the canonical key and url", () => {
    const ref = vncRef("vnc://localhost:5920");
    expect(ref === undefined ? "" : vncKey(ref)).toBe("127.0.0.1:5920");
    expect(ref === undefined ? "" : vncUrl(ref)).toBe("vnc://127.0.0.1:5920");
  });
});

describe("vnc stream paths", () => {
  test("path-addressed endpoints carry the target without a query string", () => {
    const ref = { kind: "vnc" as const, host: "127.0.0.1", port: 5920 };
    expect(vncPath(ref)).toBe("/stream/vnc/127.0.0.1/5920");
    expect(vncProbePath(ref)).toBe("/stream/vnc/127.0.0.1/5920/probe");
    expect(vncFromPath(vncPath(ref))).toEqual({ target: ref, probe: false });
    expect(vncFromPath(vncProbePath(ref))).toEqual({ target: ref, probe: true });
    expect(vncFromPath("/stream/vnc/example.com/5920")).toBeUndefined();
  });
});
