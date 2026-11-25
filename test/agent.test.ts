import { describe, expect, test } from "bun:test";
import type {
  AgentOperationErrorCode,
  AgentRuntime,
  Caller,
  PluginContext,
  Principal,
  Session,
} from "@valethq/sdk";
import { ServiceDeniedError } from "@valethq/sdk";
import { registerAgent } from "../src/agent";

type Handler = (
  req: Request,
  ctx: {
    caller: Caller;
    principal: Principal | undefined;
    params: Record<string, string>;
    url: URL;
  },
) => Response | Promise<Response>;

const caller: Caller = {
  plugin: "core",
  actor: {
    principalId: "pri_owner",
    role: "owner",
    tags: ["web"],
    cap: ["core:session.write"],
  },
  authenticatedBy: "local-test-identity",
  credentialId: "local-test-identity:cred",
  verifiedLogin: true,
};
const principal: Principal = { id: "pri_owner", displayName: "Owner", role: "owner" };
const subject = {
  actor: {
    principalId: "pri_owner",
    role: "owner",
    tags: ["web"],
    cap: ["core:session.write"],
  },
  authenticatedBy: "local-test-identity",
  credentialId: "local-test-identity:cred",
  verifiedLogin: true,
};

const session = (id: string, projectId = "prj_1"): Session => ({
  id,
  projectId,
  title: null,
  color: null,
  parentSessionId: null,
  status: "idle",
  settings: {},
  providerState: {},
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
  lastResponseAt: null,
});

function setup(runtime?: AgentRuntime) {
  const routes = new Map<string, Handler>();
  const acls = new Map<string, { permission?: string; resource?: (req: Request) => unknown }>();
  const ctx = {
    scopes: {
      maybe: (name: string) => (name === "agent" ? runtime : undefined),
    },
    store: {
      sessions: {
        get: (id: string) => (id === "ses_1" ? session(id) : undefined),
      },
    },
    http: {
      route: (method: string, path: string, handler: Handler, acl: { permission?: string }) => {
        routes.set(`${method} ${path}`, handler);
        acls.set(`${method} ${path}`, acl);
      },
    },
  } as unknown as PluginContext;
  registerAgent(ctx);
  const call = (
    key: string,
    path: string,
    params: Record<string, string> = {},
    body?: string,
  ): Promise<Response> | Response => {
    const handler = routes.get(key);
    if (handler === undefined) throw new Error(`missing route ${key}`);
    return handler(new Request(`http://x${path}`, { method: key.split(" ")[0], body }), {
      caller,
      principal,
      params,
      url: new URL(`http://x${path}`),
    });
  };
  return { acls, call };
}

class OperationError extends Error {
  constructor(
    readonly code: AgentOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentOperationError";
  }
}

function runtime(over: Partial<AgentRuntime> = {}): { impl: AgentRuntime; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const impl: AgentRuntime = {
    models: async () => [{ provider: "alternate-test", kind: "agent", label: "Alternate", models: [] }],
    state: (id) =>
      id === "ses_1"
        ? { activeRunId: "run_1", queued: 2, model: { provider: "alternate-test", model: "m" } }
        : undefined,
    fork: async (id, opts) => {
      calls.push(["fork", id, opts]);
      return session("ses_2");
    },
    move: async (id, projectId, opts) => {
      calls.push(["move", id, projectId, opts]);
      return session("ses_3", "prj_2");
    },
    compact: async (id, opts) => {
      calls.push(["compact", id, opts]);
    },
    ...over,
  };
  return { impl, calls };
}

describe("agent route ACLs", () => {
  test("models uses valet-ui's provider-agnostic permission; session actions use core session permissions", () => {
    const { acls } = setup(runtime().impl);
    expect(acls.get("GET /agent/models")?.permission).toBe("ui:model.read");
    expect(acls.get("GET /agent/sessions/:id/state")?.permission).toBe("core:session.read");
    for (const key of [
      "POST /agent/sessions/:id/fork",
      "POST /agent/sessions/:id/move",
      "POST /agent/sessions/:id/compact",
    ]) {
      expect(acls.get(key)?.permission).toBe("core:session.write");
    }
    const resource = acls.get("POST /agent/sessions/:id/move")?.resource;
    expect(resource?.(new Request("http://x/plugins/valet-ui/agent/sessions/ses_1/move"))).toEqual({
      id: "session:ses_1",
      ancestors: ["project:prj_1"],
    });
  });

  test("no cancel route is registered: cancellation stays on core's run route", () => {
    const { acls } = setup(runtime().impl);
    expect(acls.get("POST /agent/sessions/:id/cancel")).toBeUndefined();
  });
});

describe("agent routes", () => {
  test("models answers the catalog from an alternate-provider fixture", async () => {
    const { call } = setup(runtime().impl);
    const res = await call("GET /agent/models", "/plugins/valet-ui/agent/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [{ provider: "alternate-test", kind: "agent", label: "Alternate", models: [] }],
    });
  });

  test("each route is unavailable without an agent provider", async () => {
    const { call } = setup();
    for (const [key, path] of [
      ["GET /agent/models", "/plugins/valet-ui/agent/models"],
      ["GET /agent/sessions/:id/state", "/plugins/valet-ui/agent/sessions/ses_1/state"],
      ["POST /agent/sessions/:id/fork", "/plugins/valet-ui/agent/sessions/ses_1/fork"],
      ["POST /agent/sessions/:id/move", "/plugins/valet-ui/agent/sessions/ses_1/move"],
      ["POST /agent/sessions/:id/compact", "/plugins/valet-ui/agent/sessions/ses_1/compact"],
    ] as const) {
      const res = await call(key, path, { id: "ses_1" }, "{}");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: { code: "unavailable", message: "no agent provider" } });
    }
  });

  test("state returns the provider state and an unknown session is 404", async () => {
    const { call } = setup(runtime().impl);
    const res = await call("GET /agent/sessions/:id/state", "/plugins/valet-ui/agent/sessions/ses_1/state", {
      id: "ses_1",
    });
    expect(await res.json()).toEqual({
      activeRunId: "run_1",
      queued: 2,
      model: { provider: "alternate-test", model: "m" },
    });
    const missing = await call(
      "GET /agent/sessions/:id/state",
      "/plugins/valet-ui/agent/sessions/ses_missing/state",
      { id: "ses_missing" },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "not_found", message: "unknown session" } });
  });

  test("fork, move and compact delegate with the authenticated subject and without a plugin id", async () => {
    const { impl, calls } = runtime();
    const { call } = setup(impl);
    const forked = await call(
      "POST /agent/sessions/:id/fork",
      "/plugins/valet-ui/agent/sessions/ses_1/fork",
      { id: "ses_1" },
      JSON.stringify({ messageId: "msg_7" }),
    );
    expect(forked.status).toBe(201);
    const moved = await call(
      "POST /agent/sessions/:id/move",
      "/plugins/valet-ui/agent/sessions/ses_1/move",
      { id: "ses_1" },
      JSON.stringify({ projectId: "prj_2" }),
    );
    expect(moved.status).toBe(200);
    const compacted = await call(
      "POST /agent/sessions/:id/compact",
      "/plugins/valet-ui/agent/sessions/ses_1/compact",
      { id: "ses_1" },
      JSON.stringify({ instructions: "keep decisions" }),
    );
    expect(compacted.status).toBe(200);
    expect(await compacted.json()).toEqual({ ok: true });
    expect(calls).toEqual([
      ["fork", "ses_1", { messageId: "msg_7", subject }],
      ["move", "ses_1", "prj_2", { subject }],
      ["compact", "ses_1", { instructions: "keep decisions", subject }],
    ]);
    for (const entry of calls) {
      const opts = entry.at(-1) as Record<string, unknown>;
      expect(opts.subject).not.toHaveProperty("plugin");
    }
  });

  test("optional fields may be omitted and invalid bodies are 400", async () => {
    const { impl, calls } = runtime();
    const { call } = setup(impl);
    await call(
      "POST /agent/sessions/:id/fork",
      "/plugins/valet-ui/agent/sessions/ses_1/fork",
      { id: "ses_1" },
      "{}",
    );
    await call(
      "POST /agent/sessions/:id/compact",
      "/plugins/valet-ui/agent/sessions/ses_1/compact",
      { id: "ses_1" },
      "{}",
    );
    expect(calls).toEqual([
      ["fork", "ses_1", { subject }],
      ["compact", "ses_1", { subject }],
    ]);
    for (const [key, body] of [
      ["POST /agent/sessions/:id/fork", JSON.stringify({ messageId: 4 })],
      ["POST /agent/sessions/:id/move", "{}"],
      ["POST /agent/sessions/:id/compact", JSON.stringify({ instructions: 4 })],
      ["POST /agent/sessions/:id/compact", "[1]"],
    ] as const) {
      const res = await call(key, "/plugins/valet-ui/agent/sessions/ses_1/x", { id: "ses_1" }, body);
      expect(res.status).toBe(400);
    }
  });

  test("AgentOperationError codes map to their HTTP statuses", async () => {
    for (const [code, status] of [
      ["not_found", 404],
      ["busy", 409],
      ["unsupported", 501],
      ["bad_request", 400],
    ] as const) {
      const { impl } = runtime({
        move: async () => {
          throw new OperationError(code, `failed as ${code}`);
        },
      });
      const { call } = setup(impl);
      const res = await call(
        "POST /agent/sessions/:id/move",
        "/plugins/valet-ui/agent/sessions/ses_1/move",
        { id: "ses_1" },
        JSON.stringify({ projectId: "prj_2" }),
      );
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: { code, message: `failed as ${code}` } });
    }
  });

  test("ServiceDeniedError keeps core's denied shape", async () => {
    const denied = new ServiceDeniedError("not for this session");
    Object.assign(denied, { by: "alternate-manager" });
    const { impl } = runtime({
      fork: async () => {
        throw denied;
      },
    });
    const { call } = setup(impl);
    const res = await call(
      "POST /agent/sessions/:id/fork",
      "/plugins/valet-ui/agent/sessions/ses_1/fork",
      { id: "ses_1" },
      "{}",
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "denied", by: "alternate-manager", reason: "not for this session" },
    });
  });
});
