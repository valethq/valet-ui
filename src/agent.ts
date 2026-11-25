import {
  type AgentOperationErrorCode,
  type AgentSubject,
  type Caller,
  type PluginContext,
  ServiceDeniedError,
  sessionResource,
} from "@valethq/sdk";

const STATUSES: Record<AgentOperationErrorCode, number> = {
  not_found: 404,
  busy: 409,
  unsupported: 501,
  bad_request: 400,
};

const errorJson = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response => Response.json({ error: { code, message, ...extra } }, { status });

const unavailable = (): Response => errorJson(503, "unavailable", "no agent provider");

const operationError = (error: unknown): { code: AgentOperationErrorCode; message: string } | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: unknown; message?: unknown };
  return typeof e.message === "string" && typeof e.code === "string" && e.code in STATUSES
    ? { code: e.code as AgentOperationErrorCode, message: e.message }
    : undefined;
};

/** Maps the agent contract's errors; anything else still reaches core's generic 500. */
function failure(error: unknown): Response {
  if (error instanceof ServiceDeniedError) {
    return Response.json(
      {
        error: {
          code: "denied",
          ...(error.by === undefined ? {} : { by: error.by }),
          reason: error.reason || error.message,
        },
      },
      { status: 403 },
    );
  }
  const operation = operationError(error);
  if (operation === undefined) throw error;
  return errorJson(STATUSES[operation.code], operation.code, operation.message);
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | undefined> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const badRequest = (message: string): Response => errorJson(400, "bad_request", message);

/** The `:id` core's router hands the handler: the decoded segment after `sessions`. */
const sessionIdOf = (req: Request): string => {
  const segments = new URL(req.url).pathname.split("/").filter((s) => s !== "");
  const raw = segments[segments.indexOf("sessions") + 1] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** The authenticated control-plane subject, delegated without core's caller plugin id. */
export function subjectOf(caller: Caller): AgentSubject {
  const { plugin: _, ...subject } = caller;
  return subject;
}

/**
 * Browser-facing agent routes in valet-ui's own namespace. They authorize on core's session resource,
 * then delegate to whichever plugin provides agent@1; no provider id appears here.
 */
export function registerAgent(ctx: PluginContext): void {
  const agent = () => ctx.scopes.maybe("agent");
  const resourceOf = (req: Request) => sessionResource(ctx, sessionIdOf(req));

  ctx.http.route(
    "GET",
    "/agent/models",
    async () => {
      const runtime = agent();
      if (runtime === undefined) return unavailable();
      try {
        return Response.json({ providers: await runtime.models() });
      } catch (error) {
        return failure(error);
      }
    },
    { permission: "ui:model.read" },
  );

  ctx.http.route(
    "GET",
    "/agent/sessions/:id/state",
    (_req, { params }) => {
      const runtime = agent();
      if (runtime === undefined) return unavailable();
      try {
        const state = runtime.state(params.id as string);
        return state === undefined ? errorJson(404, "not_found", "unknown session") : Response.json(state);
      } catch (error) {
        return failure(error);
      }
    },
    { permission: "core:session.read", resource: resourceOf },
  );

  ctx.http.route(
    "POST",
    "/agent/sessions/:id/fork",
    async (req, { params, caller }) => {
      const runtime = agent();
      if (runtime === undefined) return unavailable();
      const body = await bodyOf(req);
      if (body === undefined) return badRequest("invalid JSON body");
      if (body.messageId !== undefined && typeof body.messageId !== "string") {
        return badRequest("messageId must be a string");
      }
      try {
        const session = await runtime.fork(params.id as string, {
          ...(body.messageId === undefined ? {} : { messageId: body.messageId }),
          subject: subjectOf(caller),
        });
        return Response.json(session, { status: 201 });
      } catch (error) {
        return failure(error);
      }
    },
    { permission: "core:session.write", resource: resourceOf },
  );

  ctx.http.route(
    "POST",
    "/agent/sessions/:id/move",
    async (req, { params, caller }) => {
      const runtime = agent();
      if (runtime === undefined) return unavailable();
      const body = await bodyOf(req);
      if (body === undefined) return badRequest("invalid JSON body");
      if (typeof body.projectId !== "string") return badRequest("projectId is required");
      try {
        const session = await runtime.move(params.id as string, body.projectId, {
          subject: subjectOf(caller),
        });
        return Response.json(session);
      } catch (error) {
        return failure(error);
      }
    },
    { permission: "core:session.write", resource: resourceOf },
  );

  ctx.http.route(
    "POST",
    "/agent/sessions/:id/compact",
    async (req, { params, caller }) => {
      const runtime = agent();
      if (runtime === undefined) return unavailable();
      const body = await bodyOf(req);
      if (body === undefined) return badRequest("invalid JSON body");
      if (body.instructions !== undefined && typeof body.instructions !== "string") {
        return badRequest("instructions must be a string");
      }
      try {
        await runtime.compact(params.id as string, {
          ...(body.instructions === undefined ? {} : { instructions: body.instructions }),
          subject: subjectOf(caller),
        });
        return Response.json({ ok: true });
      } catch (error) {
        return failure(error);
      }
    },
    { permission: "core:session.write", resource: resourceOf },
  );
}
