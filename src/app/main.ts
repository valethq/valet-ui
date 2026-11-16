/// <reference lib="dom" />
import * as api from "./api";
import { el, leave } from "./dom";
import {
  applyDelta,
  applyMessageComplete,
  applyPartUpdate,
  applyMessageCreate,
  applyRunEnd,
  applyRunInfo,
  applyRunStart,
  applyRunStatus,
  applyRunUpdate,
  applySessionState,
  EventBuffer,
  forkSource,
  newSessionView,
  orphanChildren,
  childrenOf,
  replaceMessages,
  type Indicator,
  type SessionView,
  needsUser,
  sessionIndicator,
  sortSessions,
  titleSuffixes,
  topLevel,
  upsertSession,
  withQueueMode,
} from "./state";
import type {
  Message,
  MessageDelta,
  Part,
  Project,
  ProviderModels,
  QueueMode,
  Run,
  RunStatus,
  Session,
} from "./types";
import { syncCustom } from "./themes";
import { renderAuth } from "./views/auth";
import { createChat, type ChatHandle } from "./views/chat";
import { openSettings } from "./views/settings";
import { renderSidebar } from "./views/sidebar";
import { CoreSocket } from "./ws";

const root = document.getElementById("root") as HTMLElement;

function toast(message: string): void {
  const node = el("div", { class: "toast", text: message });
  document.body.append(node);
  setTimeout(() => leave(node), 5000);
}

function fatal(message: string): void {
  root.replaceChildren(
    el(
      "div",
      { class: "auth" },
      el("div", { class: "card" }, el("h1", { text: "valet" }), el("div", { class: "sub", text: message })),
    ),
  );
}

interface App {
  socket: CoreSocket;
  chat: ChatHandle | null;
  sidebar: HTMLElement;
  projects: Project[];
  projectId: string | null;
  sessions: Session[];
  providers: ProviderModels[];
  view: SessionView | null;
}

const app: App = {
  socket: new CoreSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`),
  chat: null,
  sidebar: el("div", { class: "sidebar" }),
  projects: [],
  projectId: null,
  sessions: [],
  providers: [],
  view: null,
};

let appEl: HTMLElement | null = null;
const NARROW = "(max-width: 900px), (max-height: 500px) and (pointer: coarse)";
const SIDEBAR_KEY = "valet-ui.sidebar";
const sidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
};
/** Narrow screens open the drawer; wide ones pin/unpin the floating sidebar.
 * `no-peek` stops an unpin clicked from inside the sidebar re-showing it as a
 * hover peek while it slides out. */
const toggleNav = (): void => {
  if (appEl === null) return;
  if (window.matchMedia(NARROW).matches) {
    appEl.classList.toggle("nav-open");
    return;
  }
  const collapsed = appEl.classList.toggle("collapsed");
  if (collapsed) {
    const node = appEl;
    node.classList.add("no-peek");
    setTimeout(() => node.classList.remove("no-peek"), 450);
  }
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "pinned");
  } catch {
    // private mode; the choice lasts until reload
  }
};
const closeNav = (): void => {
  appEl?.classList.remove("nav-open");
};

const SIDEBAR_W_KEY = "valet-ui.sidebar-width";
const SIDEBAR_W_DEFAULT = 232;
const SIDEBAR_W_MIN = 180;
const SIDEBAR_W_MAX = 420;
const clampSidebarWidth = (w: number): number =>
  Math.round(Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, w)));
const savedSidebarWidth = (): number => {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_W_KEY));
    return n ? clampSidebarWidth(n) : SIDEBAR_W_DEFAULT;
  } catch {
    return SIDEBAR_W_DEFAULT;
  }
};
/** Drag the sidebar's right edge to resize it (desktop only). The width lives in
 * `--sb-w` on the app root, so the sidebar and the main pane follow together.
 * Arrow keys nudge it, double-click resets it. */
function bindSidebarResize(handle: HTMLElement, app: HTMLElement): void {
  let width = SIDEBAR_W_DEFAULT;
  const apply = (w: number): void => {
    width = clampSidebarWidth(w);
    app.style.setProperty("--sb-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  };
  const save = (): void => {
    try {
      localStorage.setItem(SIDEBAR_W_KEY, String(width));
    } catch {
      // private mode; the width lasts until reload
    }
  };
  apply(savedSidebarWidth());

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    app.classList.add("resizing");
    const move = (ev: PointerEvent): void => apply(ev.clientX);
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      app.classList.remove("resizing");
      save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => {
    apply(SIDEBAR_W_DEFAULT);
    save();
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (step === 0) return;
    e.preventDefault();
    apply(width + step);
    save();
  });
}

// `valet-ui.seen.<sessionId>` stores the last seen lastMessageAt so unread
// dots survive a reload.
const seenKey = (sessionId: string): string => `valet-ui.seen.${sessionId}`;

function seenAt(sessionId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(sessionId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function noteSeen(sessionId: string, at: number): void {
  if (at <= 0) return;
  try {
    if (at > seenAt(sessionId)) localStorage.setItem(seenKey(sessionId), String(at));
  } catch {
    // private mode
  }
}

function unreadSessions(): Set<string> {
  const openId = app.view?.session.id ?? null;
  const out = new Set<string>();
  for (const s of app.sessions) {
    if (s.id !== openId && s.lastMessageAt !== null && s.lastMessageAt > seenAt(s.id)) {
      out.add(s.id);
    }
  }
  return out;
}

// Sessions whose run said it is waiting on the user (approval, question).
const attention = new Set<string>();

function indicatorFor(s: Session): Indicator {
  const open = app.view?.session.id === s.id ? app.view : null;
  const pending = open?.messages.some((cm) =>
    cm.parts.some((p) => p.data.type === "tool-call" && p.data.status === "pending"),
  );
  return sessionIndicator(
    s,
    { attention: attention.has(s.id) || pending === true, running: open?.activeRunId != null },
    Date.now(),
  );
}

let lastSidebarSig = "";
function sidebarSig(
  open: Session | undefined,
  unread: Set<string>,
  indicators: Map<string, Indicator>,
): string {
  return JSON.stringify([
    app.projectId,
    app.projects.map((p) => [p.id, p.name]),
    open?.id,
    Math.floor(Date.now() / 60_000),
    [...unread],
    [...indicators],
    app.sessions.map((s) => [s.id, s.title, s.status, s.parentSessionId, s.lastMessageAt, s.updatedAt]),
  ]);
}

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const open = app.view?.session;
    if (open !== undefined && open.lastMessageAt !== null) noteSeen(open.id, open.lastMessageAt);
    const unread = unreadSessions();
    const indicators = new Map(app.sessions.map((s) => [s.id, indicatorFor(s)]));
    const sig = sidebarSig(open, unread, indicators);
    if (sig !== lastSidebarSig) {
      lastSidebarSig = sig;
      renderSidebar(app.sidebar, {
        projects: app.projects,
        projectId: app.projectId,
        sessions: app.sessions,
        openId: open?.id ?? null,
        unread,
        indicators,
        onProject: (id) => {
          closeNav();
          void switchProject(id);
        },
        onSession: (id) => {
          closeNav();
          void openSession(id);
        },
        onRename: (id) => {
          const session = app.sessions.find((s) => s.id === id);
          if (session !== undefined) promptRename(session);
        },
        onFork: (id) => void forkFrom(id),
        onMove: (id, projectId) => void moveTo(id, projectId),
        onDelete: (id) => void deleteSession(id),
        onNew: () => {
          closeNav();
          newSession();
        },
        onLogout: () => {
          closeNav();
          void logout();
        },
        onCollapse: toggleNav,
        onSettings: () => {
          closeNav();
          openSettings({
            load: api.listSettings,
            save: api.saveSettings,
            refresh: api.getSettings,
            action: api.runSettingsAction,
          });
        },
      });
    }
    const suffix = open === undefined ? undefined : titleSuffixes(app.sessions).get(open.id);
    const forked = open === undefined ? undefined : forkSource(app.sessions, open);
    const links =
      open === undefined
        ? undefined
        : {
            ...(open.parentSessionId === null
              ? {}
              : { parent: app.sessions.find((s) => s.id === open.parentSessionId) }),
            ...(forked === undefined ? {} : { forkedFrom: forked }),
            subs: childrenOf(app.sessions, open.id).map((session) => ({
              session,
              indicator: indicators.get(session.id) ?? ("done" as const),
            })),
          };
    app.chat?.update(app.view, app.providers, suffix, draftModel, links);
  });
}

function syncTopics(): void {
  const topics = app.projectId === null ? [] : [`sessions:${app.projectId}`];
  for (const s of app.sessions) topics.push(`session:${s.id}`);
  app.socket.setTopics(topics);
}

let refetchTimer: ReturnType<typeof setTimeout> | undefined;
function refetchMessagesSoon(): void {
  if (refetchTimer !== undefined) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = undefined;
    const view = app.view;
    if (view === null) return;
    api
      .listMessages(view.session.id)
      .then((messages) => {
        if (app.view?.session.id === view.session.id) {
          replaceMessages(view, messages);
          scheduleRender();
        }
      })
      .catch(() => {});
  }, 120);
}

let stateTimer: ReturnType<typeof setTimeout> | undefined;
/** Re-reads the open session's queue depth, active run and usage from the agent. */
function refreshStateSoon(): void {
  if (stateTimer !== undefined) return;
  stateTimer = setTimeout(() => {
    stateTimer = undefined;
    const view = app.view;
    if (view === null) return;
    api
      .getSessionState(view.session.id)
      .then((state) => {
        if (app.view?.session.id !== view.session.id) return;
        applySessionState(view, state);
        scheduleRender();
      })
      .catch(() => {});
  }, 150);
}

async function loadSessions(): Promise<void> {
  if (app.projectId === null) return;
  app.sessions = sortSessions(await api.listSessions(app.projectId));
  syncTopics();
}

const sessionKey = (projectId: string): string => `valet-ui.session.${projectId}`;

function rememberedSession(projectId: string | null): string | null {
  if (projectId === null) return null;
  try {
    return localStorage.getItem(sessionKey(projectId));
  } catch {
    return null;
  }
}

function sessionFromHash(): string | null {
  const m = /^#s=(.+)$/.exec(window.location.hash);
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return m[1] as string;
  }
}

function pickSession(preferHash: boolean): Session | undefined {
  const remembered = rememberedSession(app.projectId);
  const candidates = preferHash ? [sessionFromHash(), remembered] : [remembered];
  for (const id of candidates) {
    const hit = id === null ? undefined : app.sessions.find((s) => s.id === id);
    if (hit !== undefined) return hit;
  }
  return topLevel(app.sessions)[0];
}

let openSeq = 0;
// Events for a session being opened arrive before its REST snapshot lands;
// they buffer here and replay through onEvent once the view exists.
const opening = new EventBuffer<{ name: string; data: unknown }>();
async function openSession(id: string): Promise<void> {
  const session = app.sessions.find((s) => s.id === id);
  if (session === undefined) return;
  const seq = ++openSeq;
  opening.begin(id);
  const messages = await api.listMessages(id).catch(() => []);
  if (seq !== openSeq) return;
  app.view = newSessionView(session, messages);
  for (const ev of opening.end(id)) onEvent(`session:${id}`, ev.name, ev.data);
  noteSeen(id, Math.max(session.lastMessageAt ?? 0, ...messages.map((cm) => cm.message.createdAt)));
  try {
    localStorage.setItem(sessionKey(session.projectId), id);
  } catch {
    // private mode; selection simply isn't remembered
  }
  history.replaceState(null, "", `#s=${encodeURIComponent(id)}`);
  scheduleRender();
  refreshStateSoon();

  const lastRunId = [...messages].reverse().find((cm) => cm.message.runId !== null)?.message.runId;
  if (lastRunId !== undefined && lastRunId !== null) {
    api
      .getRun(lastRunId)
      .then((run) => {
        if (app.view !== null && app.view.session.id === id) {
          applyRunInfo(app.view, run);
          scheduleRender();
        }
      })
      .catch(() => {});
  }
}

async function switchProject(id: string): Promise<void> {
  if (id === app.projectId) return;
  app.projectId = id;
  app.view = null;
  try {
    localStorage.setItem("valet-ui.project", id);
  } catch {
    // private mode; selection simply isn't remembered
  }
  await loadSessions();
  const target = pickSession(false);
  if (target !== undefined) await openSession(target.id);
  else scheduleRender();
}

/** New session is a blank landing; the session is created on the first send. */
function newSession(): void {
  app.view = null;
  history.replaceState(null, "", location.pathname + location.search);
  scheduleRender();
}

// The landing page's model pick; applied to the session when it is first created.
let draftModel: { provider: string; model: string } | undefined;

async function createSessionForDraft(): Promise<boolean> {
  if (app.projectId === null) return false;
  const session = await api.createSession(app.projectId).catch((e: unknown) => {
    toast(e instanceof Error ? e.message : "could not create session");
    return undefined;
  });
  if (session === undefined) return false;
  const pick = draftModel;
  const configured =
    pick === undefined
      ? session
      : await api.setSessionModel(session, pick.provider, pick.model).catch((e: unknown) => {
          toast(e instanceof Error ? e.message : "could not set model");
          return session;
        });
  app.sessions = upsertSession(app.sessions, configured);
  syncTopics();
  await openSession(session.id);
  return app.view !== null;
}

async function forkFrom(id: string, messageId?: string): Promise<void> {
  const forked = await api.forkSession(id, messageId).catch((e: unknown) => {
    toast(e instanceof Error ? e.message : "fork failed");
    return undefined;
  });
  if (forked === undefined) return;
  app.sessions = upsertSession(app.sessions, forked);
  syncTopics();
  await openSession(forked.id);
}

async function moveTo(id: string, projectId: string): Promise<void> {
  const open = app.view?.session.id === id ? app.view : null;
  if (
    open !== null ? open.activeRunId !== null : app.sessions.find((s) => s.id === id)?.status === "running"
  ) {
    toast("A turn is running; move once it finishes");
    return;
  }
  const moved = await api.moveSession(id, projectId).catch((e: unknown) => {
    toast(e instanceof Error ? e.message : "move failed");
    return undefined;
  });
  if (moved === undefined) return;
  const name = app.projects.find((p) => p.id === projectId)?.name ?? "another project";
  app.sessions = orphanChildren(
    app.sessions.filter((s) => s.id !== id),
    id,
  );
  syncTopics();
  toast(`Moved to ${name}`);
  if (open === null) {
    scheduleRender();
    return;
  }
  // The move gave the chat a new id in the other project; follow it there.
  app.view = null;
  try {
    localStorage.setItem(sessionKey(projectId), moved.id);
  } catch {
    // private mode; the new project opens on its latest session instead
  }
  await switchProject(projectId);
}

function compactOpen(): void {
  const view = app.view;
  if (view === null) return;
  if (view.activeRunId !== null) {
    toast("A turn is running. Compact once it finishes.");
    return;
  }
  const instructions = window.prompt("Compaction instructions (optional)", "");
  if (instructions === null) return;
  api
    .compactSession(view.session.id, instructions.trim())
    .catch((e: unknown) => toast(e instanceof Error ? e.message : "compact failed"));
}

function setQueueMode(mode: QueueMode): void {
  const view = app.view;
  if (view === null) return;
  api
    .updateSession(view.session.id, { settings: withQueueMode(view.session.settings, mode) })
    .then((session) => {
      if (app.view?.session.id === session.id) app.view.session = session;
      app.sessions = upsertSession(app.sessions, session);
      scheduleRender();
    })
    .catch((e: unknown) => toast(e instanceof Error ? e.message : "queue mode change failed"));
}

async function renameSession(id: string, title: string): Promise<void> {
  const session = await api.updateSession(id, { title }).catch((e: unknown) => {
    toast(e instanceof Error ? e.message : "rename failed");
    return undefined;
  });
  if (session === undefined) return;
  app.sessions = upsertSession(app.sessions, session);
  if (app.view?.session.id === id) app.view.session = session;
  scheduleRender();
}

async function deleteSession(id: string): Promise<void> {
  if (!window.confirm("Delete this session and its messages? This cannot be undone.")) return;
  const deleted = await api.deleteSession(id).then(
    () => true,
    (e: unknown) => {
      toast(e instanceof Error ? e.message : "delete failed");
      return false;
    },
  );
  if (!deleted) return;
  app.sessions = orphanChildren(
    app.sessions.filter((s) => s.id !== id),
    id,
  );
  syncTopics();
  if (app.view?.session.id !== id) {
    scheduleRender();
    return;
  }
  app.view = null;
  const next = pickSession(false);
  if (next !== undefined) await openSession(next.id);
  else scheduleRender();
}

function promptRename(session: Session): void {
  const title = window.prompt("Rename session", session.title ?? "")?.trim();
  if (title) void renameSession(session.id, title);
}

function onEvent(topic: string, name: string, data: unknown): void {
  const sep = topic.indexOf(":");
  const id = topic.slice(sep + 1);

  if (topic.startsWith("sessions:")) {
    const payload = data as { session: Session };
    if (name === "session.create" || name === "session.update") {
      app.sessions = upsertSession(app.sessions, payload.session);
      if (name === "session.create") syncTopics();
      if (app.view?.session.id === payload.session.id) app.view.session = payload.session;
    } else if (name === "session.delete") {
      app.sessions = orphanChildren(
        app.sessions.filter((s) => s.id !== payload.session.id),
        payload.session.id,
      );
      syncTopics();
      if (app.view?.session.id === payload.session.id) app.view = null;
    }
    scheduleRender();
    return;
  }

  if (!topic.startsWith("session:")) return;
  if (opening.push(id, { name, data })) return;
  if (name === "run.status") {
    const status = (data as RunStatus).status;
    if (needsUser(status)) attention.add(id);
    else attention.delete(id);
  } else if (name === "run.end" || name === "run.start" || name === "message.create") {
    attention.delete(id);
  }
  const view = app.view;
  if (view !== null && view.session.id === id) {
    switch (name) {
      case "message.create": {
        const p = data as { message: Message; parts: Part[] };
        applyMessageCreate(view, p.message, p.parts);
        noteSeen(id, p.message.createdAt);
        if (p.message.role === "user") refreshStateSoon();
        break;
      }
      case "message.delta":
        if (applyDelta(view, data as MessageDelta)) refetchMessagesSoon();
        break;
      case "part.update": {
        const p = data as { messageId: string; part: Part };
        if (!applyPartUpdate(view, p.messageId, p.part)) refetchMessagesSoon();
        else scheduleRender();
        break;
      }
      case "message.complete":
        applyMessageComplete(view, (data as { message: Message }).message);
        refetchMessagesSoon();
        break;
      case "run.start":
        applyRunStart(view, (data as { run: Run }).run);
        refreshStateSoon();
        break;
      case "run.update":
        applyRunUpdate(view, (data as { run: Run }).run);
        break;
      case "run.end":
        applyRunEnd(view, (data as { run: Run }).run);
        refetchMessagesSoon();
        refreshStateSoon();
        break;
      case "run.status": {
        const p = data as RunStatus;
        applyRunStatus(view, p.runId, p.status);
        break;
      }
      default:
        return;
    }
  } else if (name === "message.create") {
    const s = app.sessions.find((x) => x.id === id);
    if (s !== undefined) {
      const msg = (data as { message: Message }).message;
      app.sessions = upsertSession(app.sessions, {
        ...s,
        lastMessageAt: msg.createdAt,
        // the sidebar shows model replies only, so user messages don't move it
        ...(msg.role === "assistant" ? { lastResponseAt: msg.createdAt } : {}),
      });
    }
  } else {
    return;
  }
  scheduleRender();
}

function onGap(_topic: string): void {
  loadPartTypes();
  void loadSessions().then(() => {
    if (app.view !== null) refetchMessagesSoon();
    scheduleRender();
  });
}

function loadPartTypes(): void {
  api.listPartTypes().then(
    (types) => app.chat?.setPartTypes(types),
    () => {},
  );
}

function showLogin(): void {
  app.socket.close();
  renderAuth(root, { needsSetup: false, authenticated: false }, async ({ password }) => {
    await api.login(password);
    await startApp();
  });
}

async function logout(): Promise<void> {
  await api.logout().catch(() => {});
  showLogin();
}

async function startApp(): Promise<void> {
  app.view = null;
  app.sessions = [];
  app.projects = [];
  app.providers = [];
  app.projectId = null;

  const chatRoot = el("div", { class: "chat-root" });
  app.chat = createChat(chatRoot, {
    onSend: async (parts, clientMessageId) => {
      if (!app.socket.isLive()) {
        app.chat?.setSendError("Offline: message not sent");
        return false;
      }
      if (app.view === null && !(await createSessionForDraft())) return false;
      const view = app.view;
      if (view === null) return false;
      try {
        const cm = await api.sendMessage(view.session.id, parts, clientMessageId);
        if (app.view?.session.id === view.session.id) {
          applyMessageCreate(view, cm.message, cm.parts);
          scheduleRender();
          refreshStateSoon();
        }
        app.chat?.setSendError(null);
        return true;
      } catch (e) {
        if (api.isCommandHandled(e)) {
          // the command ran server-side; it counts as sent, so the composer clears and no error shows
          app.chat?.setSendError(null);
          return true;
        }
        const message = e instanceof Error ? e.message : "send failed";
        app.chat?.setSendError(message);
        toast(message);
        return false;
      }
    },
    onUpload: api.uploadBlob,
    onRename: () => {
      const session = app.view?.session;
      if (session !== undefined) promptRename(session);
    },
    onDelete: () => {
      if (app.view !== null) void deleteSession(app.view.session.id);
    },
    onFork: (messageId) => {
      if (app.view !== null) void forkFrom(app.view.session.id, messageId);
    },
    onMove: (projectId) => {
      if (app.view !== null) void moveTo(app.view.session.id, projectId);
    },
    onCompact: compactOpen,
    onQueueMode: setQueueMode,
    onStop: () => {
      const runId = app.view?.activeRunId;
      if (runId == null) return;
      api.cancelRun(runId).catch((e: unknown) => toast(e instanceof Error ? e.message : "cancel failed"));
    },
    onModel: (provider, model) => {
      const view = app.view;
      if (view === null) {
        draftModel = { provider, model };
        scheduleRender();
        return;
      }
      if (!app.socket.open) {
        toast("Offline: model not changed");
        scheduleRender();
        return;
      }
      if (view.activeRunId !== null) toast("Model change applies from the next message");
      api
        .setSessionModel(view.session, provider, model)
        .then((session) => {
          if (app.view?.session.id === session.id) app.view.session = session;
          app.sessions = upsertSession(app.sessions, session);
          scheduleRender();
        })
        .catch((e: unknown) => {
          toast(e instanceof Error ? e.message : "model change failed");
          // Re-render shows the persisted model again.
          scheduleRender();
        });
    },
    onToggleNav: toggleNav,
    onOpenSession: (id) => void openSession(id),
  });

  const backdrop = el("div", { class: "nav-backdrop" });
  backdrop.addEventListener("click", closeNav);
  const resizer = el("div", {
    class: "sidebar-resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize sidebar",
    "aria-valuemin": String(SIDEBAR_W_MIN),
    "aria-valuemax": String(SIDEBAR_W_MAX),
    tabindex: "0",
    title: "Drag to resize - double-click to reset",
  });
  appEl = el(
    "div",
    { class: `app${sidebarCollapsed() ? " collapsed" : ""}` },
    el("div", { class: "sidebar-edge" }),
    app.sidebar,
    resizer,
    chatRoot,
    backdrop,
  );
  bindSidebarResize(resizer, appEl);
  root.replaceChildren(appEl);

  app.socket.onEvent = onEvent;
  app.socket.onGap = onGap;
  app.socket.onDenied = (_topic, message) => toast(`subscription denied: ${message}`);
  app.socket.onState = (open) => app.chat?.setConnection(open);
  app.socket.onUnauthorized = showLogin;
  app.socket.start();

  app.projects = await api.listProjects();
  app.providers = await api.listModels().catch(() => []);
  app.chat.setProjects(app.projects);
  api.defaultQueueMode().then((mode) => app.chat?.setDefaultQueueMode(mode));
  loadPartTypes();
  const remembered = (() => {
    try {
      return localStorage.getItem("valet-ui.project");
    } catch {
      return null;
    }
  })();
  app.projectId = app.projects.find((p) => p.id === remembered)?.id ?? app.projects[0]?.id ?? null;
  await loadSessions();
  const target = pickSession(true);
  if (target !== undefined) await openSession(target.id);
  else scheduleRender();
}

api.hooks.onUnauthorized = showLogin;

window.addEventListener("hashchange", () => {
  const id = sessionFromHash();
  if (id !== null && id !== app.view?.session.id) void openSession(id);
});

async function boot(): Promise<void> {
  syncCustom();
  let status: api.AuthStatus | null = null;
  try {
    status = await api.authStatus();
  } catch {
    status = null;
  }

  if (status?.needsSetup === true) {
    renderAuth(root, status, async ({ token, password }) => {
      await api.setup(token, password);
      await startApp();
    });
    return;
  }

  // A still-valid cookie skips the login screen entirely.
  try {
    await api.listProjects();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) {
      renderAuth(root, status ?? { needsSetup: false, authenticated: false }, async ({ password }) => {
        await api.login(password);
        await startApp();
      });
    } else {
      fatal("cannot reach valet core");
    }
    return;
  }
  await startApp().catch(() => fatal("could not load valet"));
}

void boot();

// Idle sessions drift to grey after STALE_MS with no events to trigger a render.
setInterval(scheduleRender, 60_000);
