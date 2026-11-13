/// <reference lib="dom" />
import * as api from "./api";
import { el } from "./dom";
import {
  applyDelta,
  applyMessageComplete,
  applyMessageCreate,
  applyRunEnd,
  applyRunStart,
  applyRunStatus,
  newSessionView,
  replaceMessages,
  type SessionView,
  sessionColor,
  upsertSession,
} from "./state";
import type { Message, MessageDelta, Part, Project, ProviderModels, Run, RunStatus, Session } from "./types";
import { renderAuth } from "./views/auth";
import { createChat, type ChatHandle } from "./views/chat";
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
  unread: Set<string>;
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
  unread: new Set(),
  providers: [],
  view: null,
};

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSidebar(app.sidebar, {
      projects: app.projects,
      projectId: app.projectId,
      sessions: app.sessions,
      openId: app.view?.session.id ?? null,
      unread: app.unread,
      onProject: (id) => void switchProject(id),
      onSession: (id) => void openSession(id),
      onNew: () => void newSession(),
    });
    app.chat?.update(app.view, app.providers);
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
  app.sessions = await api.listSessions(app.projectId);
  syncTopics();
}

let openSeq = 0;
async function openSession(id: string): Promise<void> {
  const session = app.sessions.find((s) => s.id === id);
  if (session === undefined) return;
  const seq = ++openSeq;
  app.unread.delete(id);
  const messages = await api.listMessages(id).catch(() => []);
  if (seq !== openSeq) return;
  app.view = newSessionView(session, messages);
  document.documentElement.style.setProperty("--accent", sessionColor(session));
  scheduleRender();
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
  const first = app.sessions[0];
  if (first !== undefined) await openSession(first.id);
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
  const view = app.view;
  if (view !== null && view.session.id === id) {
    switch (name) {
      case "message.create": {
        const p = data as { message: Message; parts: Part[] };
        applyMessageCreate(view, p.message, p.parts);
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
    app.unread.add(id);
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

async function startApp(): Promise<void> {
  const chatRoot = el("div", { class: "chat-root" });
  app.chat = createChat(chatRoot, {
    onSend: (text) => {
      const view = app.view;
      if (view === null) return;
      api
        .sendMessage(view.session.id, text)
        .then((cm) => {
          if (app.view?.session.id === view.session.id) {
            applyMessageCreate(view, cm.message, cm.parts);
            scheduleRender();
          }
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "send failed"));
    },
    onStop: () => {
      const runId = app.view?.activeRunId;
      if (runId == null) return;
      api.cancelRun(runId).catch((e: unknown) => toast(e instanceof Error ? e.message : "cancel failed"));
    },
    onModel: (provider, model) => {
      const view = app.view;
      if (view === null) return;
      api
        .setSessionModel(view.session, provider, model)
        .then((session) => {
          if (app.view !== null) app.view.session = session;
          app.sessions = upsertSession(app.sessions, session);
          scheduleRender();
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "model change failed"));
    },
  });

  root.replaceChildren(el("div", { class: "app" }, app.sidebar, chatRoot));

  app.socket.onEvent = onEvent;
  app.socket.onGap = onGap;
  app.socket.onDenied = (_topic, message) => toast(`subscription denied: ${message}`);
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
  const first = app.sessions[0];
  if (first !== undefined) await openSession(first.id);
  else scheduleRender();
}

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
