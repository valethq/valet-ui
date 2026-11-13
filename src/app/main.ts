/// <reference lib="dom" />
import * as api from "./api";
import { el } from "./dom";
import {
  applyDelta,
  applyMessageComplete,
  applyMessageCreate,
  applyRunEnd,
  applyRunInfo,
  applyRunStart,
  applyRunStatus,
  applyRunUpdate,
  EventBuffer,
  newSessionView,
  replaceMessages,
  type Indicator,
  type SessionView,
  needsUser,
  sessionIndicator,
  titleSuffixes,
  upsertSession,
} from "./state";
import type { Message, MessageDelta, Part, Project, ProviderModels, Run, RunStatus, Session } from "./types";
import { renderAuth } from "./views/auth";
import { createChat, type ChatHandle } from "./views/chat";
import { openSettings } from "./views/settings";
import { renderSidebar } from "./views/sidebar";
import { CoreSocket } from "./ws";

const root = document.getElementById("root") as HTMLElement;

function toast(message: string): void {
  const node = el("div", { class: "toast", text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 5000);
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
  socket: new CoreSocket(window.VALET.coreUrl),
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

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const open = app.view?.session;
    if (open !== undefined && open.lastMessageAt !== null) noteSeen(open.id, open.lastMessageAt);
    renderSidebar(app.sidebar, {
      projects: app.projects,
      projectId: app.projectId,
      sessions: app.sessions,
      openId: open?.id ?? null,
      unread: unreadSessions(),
      indicators: new Map(app.sessions.map((s) => [s.id, indicatorFor(s)])),
      onProject: (id) => {
        closeNav();
        void switchProject(id);
      },
      onSession: (id) => {
        closeNav();
        void openSession(id);
      },
      onNew: () => {
        closeNav();
        void newSession();
      },
      onLogout: () => {
        closeNav();
        void logout();
      },
      onCollapse: toggleNav,
      onSettings: () => {
        closeNav();
        openSettings({ load: api.listSettings, save: api.saveSettings });
      },
    });
    const suffix = open === undefined ? undefined : titleSuffixes(app.sessions).get(open.id);
    app.chat?.update(app.view, app.providers, suffix, open === undefined ? undefined : indicatorFor(open));
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

async function loadSessions(): Promise<void> {
  if (app.projectId === null) return;
  app.sessions = (await api.listSessions(app.projectId)).sort((a, b) => b.createdAt - a.createdAt);
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
  return app.sessions[0];
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

async function newSession(): Promise<void> {
  if (app.projectId === null) return;
  const session = await api.createSession(app.projectId).catch((e: unknown) => {
    toast(e instanceof Error ? e.message : "could not create session");
    return undefined;
  });
  if (session === undefined) return;
  app.sessions = upsertSession(app.sessions, session);
  syncTopics();
  await openSession(session.id);
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
      app.sessions = app.sessions.filter((s) => s.id !== payload.session.id);
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
        break;
      }
      case "message.delta":
        if (applyDelta(view, data as MessageDelta)) refetchMessagesSoon();
        break;
      case "message.complete":
        applyMessageComplete(view, (data as { message: Message }).message);
        refetchMessagesSoon();
        break;
      case "run.start":
        applyRunStart(view, (data as { run: Run }).run);
        break;
      case "run.update":
        applyRunUpdate(view, (data as { run: Run }).run);
        break;
      case "run.end":
        applyRunEnd(view, (data as { run: Run }).run);
        refetchMessagesSoon();
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
      app.sessions = upsertSession(app.sessions, {
        ...s,
        lastMessageAt: (data as { message: Message }).message.createdAt,
      });
    }
  } else {
    return;
  }
  scheduleRender();
}

function onGap(_topic: string): void {
  void loadSessions().then(() => {
    if (app.view !== null) refetchMessagesSoon();
    scheduleRender();
  });
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
    onSend: async (text, clientMessageId) => {
      const view = app.view;
      if (view === null) return false;
      if (!app.socket.isLive()) {
        app.chat?.setSendError("Offline: message not sent");
        return false;
      }
      try {
        const cm = await api.sendMessage(view.session.id, text, clientMessageId);
        if (app.view?.session.id === view.session.id) {
          applyMessageCreate(view, cm.message, cm.parts);
          scheduleRender();
        }
        app.chat?.setSendError(null);
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : "send failed";
        app.chat?.setSendError(message);
        toast(message);
        return false;
      }
    },
    onStop: () => {
      const runId = app.view?.activeRunId;
      if (runId == null) return;
      api.cancelRun(runId).catch((e: unknown) => toast(e instanceof Error ? e.message : "cancel failed"));
    },
    onModel: (provider, model) => {
      const view = app.view;
      if (view === null) return;
      if (!app.socket.open) {
        toast("Offline: model not changed");
        scheduleRender();
        return;
      }
      if (view.activeRunId !== null) toast("Model change applies from the next message");
      api
        .setSessionModel(view.session, provider, model)
        .then((session) => {
          if (app.view !== null) app.view.session = session;
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
  });

  const backdrop = el("div", { class: "nav-backdrop" });
  backdrop.addEventListener("click", closeNav);
  appEl = el(
    "div",
    { class: `app${sidebarCollapsed() ? " collapsed" : ""}` },
    el("div", { class: "sidebar-edge" }),
    app.sidebar,
    chatRoot,
    backdrop,
  );
  root.replaceChildren(appEl);

  app.socket.onEvent = onEvent;
  app.socket.onGap = onGap;
  app.socket.onDenied = (_topic, message) => toast(`subscription denied: ${message}`);
  app.socket.onState = (open) => app.chat?.setConnection(open);
  app.socket.onUnauthorized = showLogin;
  app.socket.start();

  app.projects = await api.listProjects();
  app.providers = await api.listModels().catch(() => []);
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
      fatal(`cannot reach core at ${window.VALET.coreUrl}`);
    }
    return;
  }
  await startApp().catch(() => fatal(`could not load valet from ${window.VALET.coreUrl}`));
}

void boot();

// Idle sessions drift to grey after STALE_MS with no events to trigger a render.
setInterval(scheduleRender, 60_000);
