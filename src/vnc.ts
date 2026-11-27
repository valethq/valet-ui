export interface VncRef {
  kind: "vnc";
  host: string;
  port: number;
}

const loopback = (host: string): string | undefined => {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" ? "127.0.0.1" : undefined;
};

/** A loopback VNC target, or undefined when the input is not one. */
export function vncTarget(
  host: string | null | undefined,
  rawPort: string | number | null | undefined,
): VncRef | undefined {
  if (typeof host !== "string" || host === "") return undefined;
  const normalized = loopback(host);
  if (normalized === undefined) return undefined;
  const port =
    typeof rawPort === "number"
      ? rawPort
      : rawPort === null || rawPort === undefined || rawPort === ""
        ? Number.NaN
        : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { kind: "vnc", host: normalized, port };
}

/** Parses `vnc://<loopback host>:<port>`. The UI previews loopback targets only. */
export function vncRef(href: string): VncRef | undefined {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "vnc:") return undefined;
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return undefined;
  }
  return vncTarget(url.hostname, url.port === "" ? "5900" : url.port);
}

export const vncKey = (ref: VncRef): string => `${ref.host}:${ref.port}`;
export const vncUrl = (ref: VncRef): string => `vnc://${ref.host}:${ref.port}`;
export const vncLabel = (ref: VncRef): string => `${ref.host}:${ref.port}`;

export const vncQuery = (ref: VncRef): string =>
  new URLSearchParams({ host: ref.host, port: String(ref.port) }).toString();

export function vncFromQuery(params: URLSearchParams): VncRef | undefined {
  return vncTarget(params.get("host"), params.get("port"));
}
