import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  authStatus,
  blobUrl,
  compactSession,
  defaultQueueMode,
  deleteSession,
  forkSession,
  getSessionState,
  isCommandHandled,
  listProjects,
  listPartTypes,
  listSettings,
  moveSession,
  releaseBlobUrl,
  saveSettings,
  sendMessage,
  updateSession,
  uploadBlob,
} from "../src/app/api";

const g = globalThis as Record<string, unknown>;
const realFetch = g.fetch;
const realTimeout = AbortSignal.timeout;
const realWindow = g.window;

let timeouts: number[] = [];

afterEach(() => {
  g.fetch = realFetch;
  AbortSignal.timeout = realTimeout;
  g.window = realWindow;
});

function stubFetch(handler: () => Response): void {
  timeouts = [];
  AbortSignal.timeout = ((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  }) as typeof AbortSignal.timeout;
  g.fetch = (() => Promise.resolve(handler())) as unknown as typeof fetch;
}

describe("request timeouts", () => {
  test("sendMessage fails fast with an 8s timeout", async () => {
    stubFetch(() => new Response('{"id":"msg_1"}', { status: 200 }));
    await sendMessage("ses_1", [{ type: "text", text: "hi" }], "cm_1");
    expect(timeouts).toEqual([8_000]);
  });

  test("other calls keep the 15s default", async () => {
    stubFetch(() => new Response("[]", { status: 200 }));
    await listProjects();
    expect(timeouts).toEqual([15_000]);
  });
});

describe("sendMessage failure", () => {
  test("a dead network surfaces as an ApiError with status 0", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await sendMessage("ses_1", [{ type: "text", text: "hi" }], "cm_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toBe("Network unreachable, try again");
  });
});

describe("slash commands", () => {
  const cancelled = (reason: string) =>
    new Response(JSON.stringify({ error: { code: "cancelled", reason } }), { status: 409 });

  test("a command the server ran is not a send failure", async () => {
    stubFetch(() => cancelled("command /compact"));
    const err = await sendMessage("ses_1", [{ type: "text", text: "/compact" }], "cm_1").catch(
      (e: unknown) => e,
    );
    expect(isCommandHandled(err)).toBe(true);
  });

  test("other cancellations and errors still fail the send", async () => {
    stubFetch(() => cancelled("role policy"));
    const policy = await sendMessage("ses_1", [{ type: "text", text: "hi" }], "cm_1").catch(
      (e: unknown) => e,
    );
    expect(isCommandHandled(policy)).toBe(false);
    expect(isCommandHandled(new ApiError(500, "command /compact"))).toBe(false);
    expect(isCommandHandled(new Error("command /compact"))).toBe(false);
  });
});

describe("attachments", () => {
  test("sendMessage posts text and file parts together", async () => {
    let seen: { url: string; body?: unknown } = { url: "" };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, body: init.body };
      return Promise.resolve(new Response('{"message":{"id":"msg_1"},"parts":[]}', { status: 201 }));
    }) as unknown as typeof fetch;
    const parts = [
      { type: "text" as const, text: "look" },
      { type: "file" as const, blobId: "blb_1", name: "a.png", mime: "image/png" },
    ];
    await sendMessage("ses_1", parts, "cm_1");
    expect(seen).toEqual({
      url: "/api/core/sessions/ses_1/messages",
      body: JSON.stringify({ role: "user", parts, clientMessageId: "cm_1" }),
    });
  });

  test("uploadBlob sends the bytes as base64 and resolves the blob id", async () => {
    let seen: { url: string; method?: string; body?: unknown } = { url: "" };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, method: init.method, body: init.body };
      return Promise.resolve(new Response('{"id":"blb_1"}', { status: 201 }));
    }) as unknown as typeof fetch;
    const id = await uploadBlob(
      new File([new Uint8Array([104, 105])], "hi.pdf", { type: "application/pdf" }),
    );
    expect(id).toBe("blb_1");
    expect(seen).toEqual({
      url: "/api/core/blobs",
      method: "POST",
      body: JSON.stringify({ data: "aGk=", mime: "application/pdf", name: "hi.pdf" }),
    });
  });

  test("uploadBlob falls back to a generic mime type", async () => {
    let body = "";
    g.fetch = ((_url: string, init: RequestInit) => {
      body = String(init.body);
      return Promise.resolve(new Response('{"id":"blb_2"}', { status: 201 }));
    }) as unknown as typeof fetch;
    await uploadBlob(new File(["x"], "data.bin"));
    expect(JSON.parse(body).mime).toBe("application/octet-stream");
  });

  test("blobUrl fetches a stored blob once and returns an object URL", async () => {
    let calls = 0;
    g.fetch = ((url: string) => {
      calls++;
      expect(url).toBe("/api/core/blobs/blb_9");
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
      );
    }) as unknown as typeof fetch;
    const first = await blobUrl("blb_9");
    expect(first).toStartWith("blob:");
    expect(await blobUrl("blb_9")).toBe(first);
    expect(calls).toBe(1);
  });

  test("releaseBlobUrl revokes the object URL and the next blobUrl fetches again", async () => {
    let calls = 0;
    g.fetch = (() => {
      calls++;
      return Promise.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }));
    }) as unknown as typeof fetch;
    const revoked: string[] = [];
    const realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
    };
    try {
      const first = await blobUrl("blb_rel");
      releaseBlobUrl("blb_rel");
      await Promise.resolve();
      expect(revoked).toEqual([first]);
      const second = await blobUrl("blb_rel");
      expect(second).not.toBe(first);
      expect(calls).toBe(2);
      releaseBlobUrl("blb_unknown");
    } finally {
      URL.revokeObjectURL = realRevoke;
    }
  });
});

describe("settings", () => {
  test("saveSettings PUTs the values to valet-ui's route on core", async () => {
    let seen: { url: string; method?: string; body?: unknown } = { url: "" };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, method: init.method, body: init.body };
      return Promise.resolve(new Response('{"key":"agent","values":{"a":2}}'));
    }) as unknown as typeof fetch;
    await saveSettings("agent/main", { a: 2 });
    expect(seen).toEqual({
      url: "/plugins/valet-ui/settings/agent%2Fmain",
      method: "PUT",
      body: '{"a":2}',
    });
  });

  test("a provider's rejection message surfaces as the error text", async () => {
    stubFetch(() => new Response('{"error":"port is taken"}', { status: 422 }));
    const err = await listSettings().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe("port is taken");
  });
});

describe("settings panels get friendly plugin names", () => {
  const panels = [
    { key: "agent", plugin: "valet-agent", title: "Agent", schema: {}, values: {} },
    { key: "ui", plugin: "valet-ui", title: "Web", schema: {}, values: {} },
  ];
  const stubRoutes = (plugins: () => Response) => {
    g.fetch = ((url: string) =>
      Promise.resolve(
        url.startsWith("/api/core/plugins") ? plugins() : new Response(JSON.stringify(panels)),
      )) as unknown as typeof fetch;
  };

  test("each panel gets its plugin's manifest name from core", async () => {
    stubRoutes(
      () =>
        new Response(
          JSON.stringify([
            { id: "valet-agent", name: "Agent", state: "active" },
            { id: "valet-ui", state: "active" },
          ]),
        ),
    );
    const [agent, ui] = await listSettings();
    expect(agent?.pluginName).toBe("Agent");
    expect(ui?.pluginName).toBeUndefined();
    expect(ui?.plugin).toBe("valet-ui");
  });

  test("a failed plugin list leaves panels listed without names", async () => {
    stubRoutes(() => new Response('{"error":"nope"}', { status: 500 }));
    const entries = await listSettings();
    expect(entries.map((e) => e.title)).toEqual(["Agent", "Web"]);
    expect(entries.every((e) => e.pluginName === undefined)).toBe(true);
  });
});

describe("part types", () => {
  const types = [
    { id: "valet-exec/job-end@1", plugin: { id: "valet-exec", version: "0.1.0" } },
    { id: "gone/thing@1", plugin: { id: "gone", version: "1.0.0" } },
  ];
  const stubRoutes = (plugins: () => Response) => {
    g.fetch = ((url: string) =>
      Promise.resolve(
        url.startsWith("/api/core/plugins") ? plugins() : new Response(JSON.stringify(types)),
      )) as unknown as typeof fetch;
  };

  test("each type is marked loaded when its plugin is active", async () => {
    stubRoutes(() => new Response(JSON.stringify([{ id: "valet-exec", state: "active" }])));
    expect((await listPartTypes()).map((t) => t.loaded)).toEqual([true, false]);
  });

  test("a failed plugin list leaves types unmarked", async () => {
    stubRoutes(() => new Response('{"error":"nope"}', { status: 500 }));
    expect((await listPartTypes()).map((t) => t.loaded)).toEqual([undefined, undefined]);
  });
});

describe("session management", () => {
  test("deleteSession sends DELETE to the core session route", async () => {
    let seen: { url: string; method?: string } = { url: "" };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, method: init.method };
      return Promise.resolve(new Response('{"id":"ses_1"}'));
    }) as unknown as typeof fetch;
    await deleteSession("ses_1");
    expect(seen).toEqual({ url: "/api/core/sessions/ses_1", method: "DELETE" });
  });

  test("updateSession renames with a PATCH carrying only the title", async () => {
    let seen: { url: string; method?: string; body?: unknown } = { url: "" };
    g.fetch = ((url: string, init: RequestInit) => {
      seen = { url, method: init.method, body: init.body };
      return Promise.resolve(new Response('{"id":"ses_1"}'));
    }) as unknown as typeof fetch;
    await updateSession("ses_1", { title: "Renamed" });
    expect(seen).toEqual({
      url: "/api/core/sessions/ses_1",
      method: "PATCH",
      body: '{"title":"Renamed"}',
    });
  });
});

describe("authStatus", () => {
  test("valet-auth's setupRequired means first-boot setup", async () => {
    stubFetch(() => new Response('{"setupRequired":true}', { status: 200 }));
    expect((await authStatus()).needsSetup).toBe(true);
    stubFetch(() => new Response('{"setupRequired":false}', { status: 200 }));
    expect((await authStatus()).needsSetup).toBe(false);
  });
});

describe("valet-agent session actions", () => {
  const record = (res: () => Response): { calls: { url: string; method?: string; body?: unknown }[] } => {
    const rec: { calls: { url: string; method?: string; body?: unknown }[] } = { calls: [] };
    g.fetch = ((url: string, init: RequestInit) => {
      rec.calls.push({ url, method: init.method, body: init.body });
      return Promise.resolve(res());
    }) as unknown as typeof fetch;
    return rec;
  };

  test("fork posts the message id when given, an empty body otherwise", async () => {
    const rec = record(() => new Response('{"id":"ses_2"}', { status: 201 }));
    await forkSession("ses_1", "msg_7");
    await forkSession("ses_1");
    expect(rec.calls).toEqual([
      {
        url: "/plugins/valet-agent/sessions/ses_1/fork",
        method: "POST",
        body: JSON.stringify({ messageId: "msg_7" }),
      },
      { url: "/plugins/valet-agent/sessions/ses_1/fork", method: "POST", body: "{}" },
    ]);
  });

  test("move posts the target project and returns the session with its new id", async () => {
    const rec = record(() => new Response('{"id":"ses_9"}', { status: 200 }));
    const moved = await moveSession("ses_1", "prj_2");
    expect(moved.id).toBe("ses_9");
    expect(rec.calls[0]).toEqual({
      url: "/plugins/valet-agent/sessions/ses_1/move",
      method: "POST",
      body: JSON.stringify({ projectId: "prj_2" }),
    });
  });

  test("a refused move reports the agent's message", async () => {
    record(
      () =>
        new Response(
          '{"error":{"code":"bad_request","message":"a turn is running; move once it finishes"}}',
          {
            status: 400,
          },
        ),
    );
    const err = await moveSession("ses_1", "prj_2").catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("a turn is running; move once it finishes");
  });

  test("state is read from the agent's state route", async () => {
    const rec = record(
      () => new Response('{"queued":2,"model":{"provider":"p","model":"m"}}', { status: 200 }),
    );
    expect((await getSessionState("ses_1")).queued).toBe(2);
    expect(rec.calls[0]?.url).toBe("/plugins/valet-agent/sessions/ses_1/state");
  });

  test("compact sends /compact, with instructions appended, and treats the command answer as success", async () => {
    const rec = record(
      () => new Response('{"error":{"code":"cancelled","reason":"command /compact"}}', { status: 409 }),
    );
    await compactSession("ses_1", "");
    await compactSession("ses_1", "keep the schema");
    const texts = rec.calls.map(
      (c) => (JSON.parse(c.body as string) as { parts: { text: string }[] }).parts[0]?.text,
    );
    expect(texts).toEqual(["/compact", "/compact keep the schema"]);
  });

  test("compact still fails on a real error", async () => {
    record(() => new Response('{"error":"nope"}', { status: 500 }));
    expect(await compactSession("ses_1", "").catch((e: unknown) => e)).toBeInstanceOf(ApiError);
  });

  test("the default queue mode comes from the agent panel and falls back to queue", async () => {
    record(
      () => new Response('{"key":"valet-agent","values":{"defaultQueueMode":"interrupt"}}', { status: 200 }),
    );
    expect(await defaultQueueMode()).toBe("interrupt");
    record(() => new Response('{"key":"valet-agent","values":{"defaultQueueMode":""}}', { status: 200 }));
    expect(await defaultQueueMode()).toBe("queue");
    record(() => new Response("{}", { status: 403 }));
    expect(await defaultQueueMode()).toBe("queue");
  });
});
