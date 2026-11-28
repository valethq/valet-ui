import { vncKey, vncProbePath, vncTarget, vncUrl, type VncRef } from "../vnc";

export type ProbeState = "unknown" | "checking" | "home" | "away" | "error";

interface Probe {
  state: ProbeState;
  at: number;
  inflight: boolean;
  error?: string;
}

const REFRESH_MS = 15_000;
const probes = new Map<string, Probe>();

const browser = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";

export function streamProbe(ref: VncRef): ProbeState {
  return probes.get(vncKey(ref))?.state ?? "unknown";
}

function label(state: ProbeState): string {
  switch (state) {
    case "checking":
      return "checking";
    case "home":
      return "home";
    case "away":
      return "nobody home";
    case "error":
      return "can't tell";
    default:
      return "not checked";
  }
}

export function streamTitle(ref: VncRef, state = streamProbe(ref), error?: string): string {
  const base = `${vncUrl(ref)} · ${label(state)}`;
  return error === undefined || error === "" ? base : `${base} · ${error}`;
}

function refOf(node: HTMLElement): VncRef | undefined {
  return vncTarget(node.getAttribute("data-stream-host"), node.getAttribute("data-stream-port"));
}

function paint(ref: VncRef, probe: Probe): void {
  if (!browser()) return;
  for (const node of document.querySelectorAll<HTMLElement>("[data-stream-kind='vnc']")) {
    const other = refOf(node);
    if (other === undefined || vncKey(other) !== vncKey(ref)) continue;
    node.setAttribute("data-probe", probe.state);
    node.title = streamTitle(ref, probe.state, probe.error);
  }
}

/** Starts a cheap RFB knock for a link, unless a fresh answer or in-flight probe already exists. */
export function probeStream(ref: VncRef, force = false): void {
  if (!browser()) return;
  const key = vncKey(ref);
  const old = probes.get(key);
  if (!force && old !== undefined && (old.inflight || Date.now() - old.at < REFRESH_MS)) return;
  const probe: Probe = {
    state: old?.state ?? "checking",
    at: old?.at ?? 0,
    inflight: true,
  };
  probes.set(key, probe);
  paint(ref, probe);
  void fetch(vncProbePath(ref), { credentials: "include", cache: "no-store" })
    .then(async (res) => {
      const body: unknown = await res.json().catch(() => undefined);
      const error =
        typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : undefined;
      const ok =
        res.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
      const state: ProbeState = ok ? "home" : res.ok ? "away" : "error";
      const detail = error ?? (state === "error" ? `probe failed with HTTP ${res.status}` : undefined);
      const done: Probe = {
        state,
        at: Date.now(),
        inflight: false,
        ...(detail === undefined ? {} : { error: detail }),
      };
      probes.set(key, done);
      paint(ref, done);
    })
    .catch((error: unknown) => {
      const done: Probe = {
        state: "error",
        at: Date.now(),
        inflight: false,
        error: error instanceof Error ? error.message : "probe failed",
      };
      probes.set(key, done);
      paint(ref, done);
    });
}

/** Probes each unique stream link currently connected under `root`. */
export function probeStreamLinks(root: ParentNode = document): void {
  if (!browser()) return;
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLElement>("[data-stream-kind='vnc']")) {
    const ref = refOf(node);
    if (ref === undefined) continue;
    const key = vncKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    probeStream(ref);
  }
}

if (typeof window !== "undefined") {
  window.setInterval(() => probeStreamLinks(), REFRESH_MS);
}
