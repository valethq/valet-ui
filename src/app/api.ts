import type {
  ChatMessage,
  CorePluginSettings,
  PartInput,
  PartType,
  PluginStatus,
  Project,
  ProviderModels,
  Run,
  SecretMeta,
  Session,
  SessionState,
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

/**
 * A slash command (`/compact`, `/model`, ...) is run by a `message.create` before hook that cancels the
 * message, so core answers 409 with the reason "command /<name>". The command ran: its result shows in the
 * chat, and the send itself did not fail.
 */
export const isCommandHandled = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 409 && e.message.startsWith("command /");

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
    throw new ApiError(0, "Network unreachable. Try again.");
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

export interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  dirs: { name: string; path: string }[];
}

export const listDirs = (path?: string): Promise<DirListing> =>
  get(`/api/core/fs/list${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`);

export const makeDir = (parent: string, name: string): Promise<{ path: string }> =>
  req("POST", "/api/core/fs/mkdir", { parent, name });

export const createProject = (workspaceDir: string, name?: string): Promise<Project> =>
  req("POST", "/api/core/projects", { workspaceDir, ...(name === undefined ? {} : { name }) });

export const updateProject = (
  projectId: string,
  patch: { name?: string; workspaceDir?: string },
): Promise<Project> => req("PATCH", `/api/core/projects/${encodeURIComponent(projectId)}`, patch);

export const deleteProject = (projectId: string): Promise<Project> =>
  req("DELETE", `/api/core/projects/${encodeURIComponent(projectId)}`);

export const listSessions = (projectId: string): Promise<Session[]> =>
  get(`/api/core/sessions?projectId=${encodeURIComponent(projectId)}`);

export const createSession = (projectId: string): Promise<Session> =>
  req("POST", "/api/core/sessions", { projectId });

export const listMessages = (sessionId: string, limit = 200): Promise<ChatMessage[]> =>
  get(`/api/core/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`);

export interface RoundResult {
  pieces: { id: string; at: number; text: string }[];
  done: boolean;
}

export type PageResult =
  | { status: 304 }
  | { status: 200; page: number; messages: ChatMessage[]; etag: string };

/** One fixed page of a chat, or the newest with `"tail"`. Sends `If-None-Match` when the caller has a copy, and
 * bypasses the browser cache: the page cache in IndexedDB is the only copy kept. */
async function uiGet(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ res: Response; text: string }> {
  try {
    const res = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers,
    });
    return { res, text: await res.text() };
  } catch {
    throw new ApiError(0, "Network unreachable. Try again.");
  }
}

function checked(res: Response): void {
  if (res.ok || res.status === 304) return;
  if (res.status === 401) hooks.onUnauthorized();
  throw new ApiError(res.status, `HTTP ${res.status}`);
}

export async function getMessagePage(
  sessionId: string,
  which: number | "tail",
  etag?: string,
): Promise<PageResult> {
  const query = which === "tail" ? "" : `?page=${which}`;
  const { res, text } = await uiGet(
    `/ui/messages/${encodeURIComponent(sessionId)}${query}`,
    etag === undefined ? {} : { "if-none-match": etag },
  );
  checked(res);
  if (res.status === 304) return { status: 304 };
  const body = JSON.parse(text) as { page: number; messages: ChatMessage[] };
  return { status: 200, page: body.page, messages: body.messages, etag: res.headers.get("etag") ?? "" };
}

/** Round `round` of the pieces still owed on a page; `etag` is the page's, so a changed page answers 409. */
export async function getMessageRound(
  sessionId: string,
  page: number,
  round: number,
  etag: string,
): Promise<RoundResult> {
  const { res, text } = await uiGet(
    `/ui/messages/${encodeURIComponent(sessionId)}?page=${page}&round=${round}&v=${encodeURIComponent(etag)}`,
  );
  checked(res);
  return JSON.parse(text) as RoundResult;
}

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

/** Frees a blob's object URL. The next `blobUrl` for it fetches the blob again. */
export function releaseBlobUrl(blobId: string): void {
  const url = blobUrls.get(blobId);
  blobUrls.delete(blobId);
  url?.then(
    (u) => URL.revokeObjectURL(u),
    () => {},
  );
}

export const getRun = (runId: string): Promise<Run> => get(`/api/core/runs/${encodeURIComponent(runId)}`);

// settings are replaced wholesale by PATCH, so merge client-side.
export const updateSession = (
  sessionId: string,
  patch: { title?: string | null; color?: string | null; settings?: Session["settings"] },
): Promise<Session> => req("PATCH", `/api/core/sessions/${encodeURIComponent(sessionId)}`, patch);

export const deleteSession = (sessionId: string): Promise<Session> =>
  req("DELETE", `/api/core/sessions/${encodeURIComponent(sessionId)}`);

export const setSessionModel = (
  session: Session,
  ref: { provider: string; model: string; effort?: string; fast?: boolean },
): Promise<Session> => {
  const fallbacks = session.settings.model?.fallbacks;
  return updateSession(session.id, {
    settings: {
      ...session.settings,
      model: {
        provider: ref.provider,
        model: ref.model,
        ...(ref.effort === undefined ? {} : { effort: ref.effort }),
        ...(ref.fast === undefined ? {} : { fast: ref.fast }),
        ...(fallbacks === undefined ? {} : { fallbacks }),
      },
    },
  });
};

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

/** The part type registry, each entry marked loaded or not. Without core's plugin list the entries come back unmarked. */
export async function listPartTypes(): Promise<PartType[]> {
  const [types, plugins] = await Promise.all([
    get<PartType[]>("/api/core/part-types"),
    get<PluginStatus[]>("/api/core/plugins").catch((): PluginStatus[] | null => null),
  ]);
  if (plugins === null) return types;
  const active = new Set(plugins.filter((p) => p.state === "active").map((p) => p.id));
  return types.map((t) => ({ ...t, loaded: active.has(t.plugin.id) }));
}

export const getSettings = (key: string): Promise<SettingsEntry> =>
  get(`/plugins/valet-ui/settings/${encodeURIComponent(key)}`);

export const runSettingsAction = (
  key: string,
  name: string,
  args: Record<string, unknown>,
): Promise<SettingsEntry> =>
  req(
    "POST",
    `/plugins/valet-ui/settings/${encodeURIComponent(key)}/actions/${encodeURIComponent(name)}`,
    args,
  );

export const saveSettings = (key: string, values: Record<string, unknown>): Promise<SettingsEntry> =>
  req("PUT", `/plugins/valet-ui/settings/${encodeURIComponent(key)}`, values);

// ---- valet-agent (11.1). Normalized like authStatus. ----

const agentSession = (id: string, action: string): string =>
  `/plugins/valet-agent/sessions/${encodeURIComponent(id)}/${action}`;

/** A new session holding the chat up to `messageId` (default: the latest message). */
export const forkSession = (id: string, messageId?: string): Promise<Session> =>
  req("POST", agentSession(id, "fork"), messageId === undefined ? {} : { messageId });

/** Gives the chat a new id in `projectId`; the original is deleted. Refused while a turn is running. */
export const moveSession = (id: string, projectId: string): Promise<Session> =>
  req("POST", agentSession(id, "move"), { projectId });

export const getSessionState = (id: string): Promise<SessionState> => get(agentSession(id, "state"));

/** Runs `/compact` through the message hook. It answers 409 once the command has run, which counts as sent. */
export async function compactSession(id: string, instructions: string): Promise<void> {
  const text = instructions === "" ? "/compact" : `/compact ${instructions}`;
  await sendMessage(id, [{ type: "text", text }], crypto.randomUUID()).catch((e: unknown) => {
    if (!isCommandHandled(e)) throw e;
  });
}

export type { CorePluginSettings };

export const listCoreSettings = (): Promise<CorePluginSettings[]> => get("/api/core/settings");

export const getCoreSettings = (plugin: string): Promise<CorePluginSettings> =>
  get(`/api/core/settings/${encodeURIComponent(plugin)}`);

export const patchCoreSettings = (
  plugin: string,
  patch: { config?: Record<string, unknown>; enabled?: boolean },
): Promise<CorePluginSettings> => req("PATCH", `/api/core/settings/${encodeURIComponent(plugin)}`, patch);

export const listSecrets = (): Promise<SecretMeta[]> => get("/api/core/secrets");

export const getSecretMeta = (name: string): Promise<SecretMeta> =>
  get(`/api/core/secrets/${encodeURIComponent(name)}`);

export const putSecret = (name: string, value: string): Promise<SecretMeta> =>
  req("PUT", `/api/core/secrets/${encodeURIComponent(name)}`, { value });

export const deleteSecret = (name: string): Promise<SecretMeta> =>
  req("DELETE", `/api/core/secrets/${encodeURIComponent(name)}`);

function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length === 0 ? undefined : out;
}

function parseModel(m: Record<string, unknown>) {
  const efforts = stringList(m.efforts);
  return {
    id: String(m.id ?? m.model ?? m.name ?? ""),
    name: String(m.name ?? m.label ?? m.id ?? m.model ?? ""),
    ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
    ...(typeof m.maxOutputTokens === "number" ? { maxOutputTokens: m.maxOutputTokens } : {}),
    ...(efforts === undefined ? {} : { efforts }),
    ...(typeof m.defaultEffort === "string" ? { defaultEffort: m.defaultEffort } : {}),
    ...(typeof m.fast === "boolean" ? { fast: m.fast } : {}),
    ...(typeof m.fastByDefault === "boolean" ? { fastByDefault: m.fastByDefault } : {}),
    ...(typeof m.hidden === "boolean" ? { hidden: m.hidden } : {}),
    ...(typeof m.show === "boolean" ? { show: m.show } : {}),
    ...(typeof m.custom === "boolean" ? { custom: m.custom } : {}),
  };
}

function catalogEntries(d: unknown): Record<string, unknown>[] {
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  const o = d as Record<string, unknown>;
  const list = o.providers ?? o.models ?? [];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

export async function listModels(): Promise<ProviderModels[]> {
  const d = (await get("/plugins/valet-agent/models")) as unknown;
  const out: ProviderModels[] = [];
  for (const e of catalogEntries(d)) {
    const provider = String(e.provider ?? e.key ?? e.id ?? "");
    if (provider === "") continue;
    const models = (Array.isArray(e.models) ? e.models : Array.isArray(e.list) ? e.list : []) as Record<
      string,
      unknown
    >[];
    out.push({
      provider,
      label: String(e.label ?? e.name ?? provider),
      ...(typeof e.icon === "string" && e.icon !== "" ? { icon: e.icon } : {}),
      models: models.map(parseModel),
    });
  }
  return out;
}
