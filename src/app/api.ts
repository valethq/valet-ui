import type { ChatMessage, Project, ProviderModels, Run, Session } from "./types";

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

const base = (): string => window.VALET.coreUrl.replace(/\/+$/, "");

async function req<T>(method: string, path: string, body?: unknown, timeout = 15_000): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base()}${path}`, {
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
    const err = data as { error?: { message?: string; reason?: string } } | undefined;
    throw new ApiError(res.status, err?.error?.reason ?? err?.error?.message ?? `HTTP ${res.status}`);
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
  const needsSetup = d.setup === true || d.needsSetup === true || d.status === "setup" || d.mode === "setup";
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

export const sendMessage = (sessionId: string, text: string, clientMessageId: string): Promise<ChatMessage> =>
  req(
    "POST",
    `/api/core/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      role: "user",
      parts: [{ type: "text", text }],
      clientMessageId,
    },
    8_000,
  );

export const getRun = (runId: string): Promise<Run> => get(`/api/core/runs/${encodeURIComponent(runId)}`);

// settings are replaced wholesale by PATCH, so merge client-side.
export const updateSession = (
  sessionId: string,
  patch: { title?: string | null; color?: string | null; settings?: Session["settings"] },
): Promise<Session> => req("PATCH", `/api/core/sessions/${encodeURIComponent(sessionId)}`, patch);

export const setSessionModel = (session: Session, provider: string, model: string): Promise<Session> =>
  updateSession(session.id, {
    settings: { ...session.settings, model: { provider, model } },
  });

export const cancelRun = (runId: string): Promise<{ ok: boolean }> =>
  req("POST", `/api/core/runs/${encodeURIComponent(runId)}/cancel`);

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
