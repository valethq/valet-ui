import type {
  ChatMessage,
  PartInput,
  PluginStatus,
  Project,
  ProviderModels,
  Run,
  Session,
  SettingsEntry,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Called when a non-auth request comes back 401 (session expired). */
export const hooks = { onUnauthorized: (): void => {} };

async function req<T>(method: string, path: string, body?: unknown, timeout = 15_000): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      signal: AbortSignal.timeout(timeout),
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    text = await res.text();
  } catch {
    // Timeout (AbortError) or dead network (TypeError) — on a dead tailnet
    // fetch hangs forever without this, and the caller never hears back.
    throw new ApiError(0, "Network unreachable, try again");
  }
  let data: unknown;
  try {
    data = text === "" ? undefined : JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/plugins/valet-auth/")) hooks.onUnauthorized();
    const err = (data as { error?: string | { message?: string; reason?: string } } | undefined)?.error;
    const message = typeof err === "string" ? err : (err?.reason ?? err?.message);
    throw new ApiError(res.status, message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

const get = <T>(path: string) => req<T>("GET", path);

// ---- valet-auth (11.7). Response shapes are normalized defensively: the
// auth plugin lands in parallel and the exact field names are not fixed. ----

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
}

export async function authStatus(): Promise<AuthStatus> {
  const d = (await get("/plugins/valet-auth/status")) as Record<string, unknown>;
  const needsSetup =
    d.setupRequired === true ||
    d.setup === true ||
    d.needsSetup === true ||
    d.status === "setup" ||
    d.mode === "setup";
  return { needsSetup, authenticated: d.authenticated === true };
}

export const setup = (token: string, password: string): Promise<unknown> =>
  req("POST", "/plugins/valet-auth/setup", { token, password });

export const login = (password: string): Promise<unknown> =>
  req("POST", "/plugins/valet-auth/login", { password });

export const logout = (): Promise<unknown> => req("POST", "/plugins/valet-auth/logout");

// ---- core REST (10.1) ----

export const listProjects = (): Promise<Project[]> => get("/api/core/projects");

export const listSessions = (projectId: string): Promise<Session[]> =>
  get(`/api/core/sessions?projectId=${encodeURIComponent(projectId)}`);

export const createSession = (projectId: string): Promise<Session> =>
  req("POST", "/api/core/sessions", { projectId });

export const listMessages = (sessionId: string, limit = 200): Promise<ChatMessage[]> =>
  get(`/api/core/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`);

export const sendMessage = (
  sessionId: string,
  parts: PartInput[],
  clientMessageId: string,
): Promise<ChatMessage> =>
  req(
    "POST",
    `/api/core/sessions/${encodeURIComponent(sessionId)}/messages`,
    { role: "user", parts, clientMessageId },
    8_000,
  );

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function uploadBlob(file: File): Promise<string> {
  const data = toBase64(new Uint8Array(await file.arrayBuffer()));
  const { id } = await req<{ id: string }>(
    "POST",
    "/api/core/blobs",
    { data, mime: file.type || "application/octet-stream", name: file.name },
    120_000,
  );
  return id;
}

const blobUrls = new Map<string, Promise<string>>();

/** An object URL for a stored blob, fetched once; used for image thumbnails. */
export function blobUrl(blobId: string): Promise<string> {
  let url = blobUrls.get(blobId);
  if (url === undefined) {
    url = fetch(`/api/core/blobs/${encodeURIComponent(blobId)}`, { credentials: "include" }).then(
      async (res) => {
        if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
        return URL.createObjectURL(await res.blob());
      },
    );
    blobUrls.set(blobId, url);
    url.catch(() => blobUrls.delete(blobId));
  }
  return url;
}

export const getRun = (runId: string): Promise<Run> => get(`/api/core/runs/${encodeURIComponent(runId)}`);

// settings are replaced wholesale by PATCH, so merge client-side.
export const updateSession = (
  sessionId: string,
  patch: { title?: string | null; color?: string | null; settings?: Session["settings"] },
): Promise<Session> => req("PATCH", `/api/core/sessions/${encodeURIComponent(sessionId)}`, patch);

export const deleteSession = (sessionId: string): Promise<Session> =>
  req("DELETE", `/api/core/sessions/${encodeURIComponent(sessionId)}`);

export const setSessionModel = (session: Session, provider: string, model: string): Promise<Session> =>
  updateSession(session.id, {
    settings: { ...session.settings, model: { provider, model } },
  });

export const cancelRun = (runId: string): Promise<{ ok: boolean }> =>
  req("POST", `/api/core/runs/${encodeURIComponent(runId)}/cancel`);

// ---- valet-ui settings panels (src/settings.ts, reached through the core relay) ----

/** Panels with each plugin's friendly manifest name. The name lookup is best-effort: without it the panels still list, labelled by id. */
export async function listSettings(): Promise<SettingsEntry[]> {
  const [entries, plugins] = await Promise.all([
    get<SettingsEntry[]>("/plugins/valet-ui/settings"),
    get<PluginStatus[]>("/api/core/plugins").catch((): PluginStatus[] => []),
  ]);
  const names = new Map(plugins.map((p) => [p.id, p.name]));
  return entries.map((e) => {
    const pluginName = names.get(e.plugin);
    return pluginName === undefined ? e : { ...e, pluginName };
  });
}

export const saveSettings = (key: string, values: Record<string, unknown>): Promise<SettingsEntry> =>
  req("PUT", `/plugins/valet-ui/settings/${encodeURIComponent(key)}`, values);

// ---- valet-agent (11.1). Normalized like authStatus. ----

export async function listModels(): Promise<ProviderModels[]> {
  const d = (await get("/plugins/valet-agent/models")) as unknown;
  const entries = Array.isArray(d)
    ? d
    : (((d as Record<string, unknown>).providers ??
        (d as Record<string, unknown>).models ??
        []) as unknown[]);
  const out: ProviderModels[] = [];
  for (const e of entries as Record<string, unknown>[]) {
    const provider = String(e.provider ?? e.key ?? e.id ?? "");
    if (provider === "") continue;
    const models = (Array.isArray(e.models) ? e.models : Array.isArray(e.list) ? e.list : []) as Record<
      string,
      unknown
    >[];
    out.push({
      provider,
      label: String(e.label ?? e.name ?? provider),
      models: models.map((m) => ({
        id: String(m.id ?? m.model ?? m.name ?? ""),
        name: String(m.name ?? m.label ?? m.id ?? m.model ?? ""),
        ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
      })),
    });
  }
  return out;
}
