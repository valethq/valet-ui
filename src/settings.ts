import type { PluginContext, ScopeProvider } from "@valethq/sdk";

export interface SettingsPanel {
  title: string;
  description?: string;
  /** JSON Schema describing the editable values; the UI renders its form from it. */
  schema: Record<string, unknown>;
  get(): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Applies and persists the values. Throw to reject; the message is shown in the UI. */
  set(values: Record<string, unknown>): void | Promise<void>;
}

declare module "@valethq/sdk" {
  interface ValetScopes {
    settings: SettingsPanel;
  }
}

export interface SettingsEntry {
  key: string;
  plugin: string;
  title: string;
  description?: string;
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function describe(p: ScopeProvider<"settings">): Promise<SettingsEntry> {
  const { title, description, schema } = p.impl;
  return {
    key: p.key,
    plugin: p.plugin,
    title,
    ...(description && { description }),
    schema,
    values: await p.impl.get(),
  };
}

export function registerSettings(ctx: PluginContext): void {
  ctx.scopes.define({ name: "settings", version: 1, cardinality: "many" });
  const find = (key: string) => ctx.scopes.all("settings").find((p) => p.key === key);

  ctx.http.route("GET", "/settings", async () =>
    json(await Promise.all(ctx.scopes.all("settings").map(describe))),
  );
  ctx.http.route("GET", "/settings/:key", async (_req, { params }) => {
    const provider = find(params.key ?? "");
    return provider ? json(await describe(provider)) : json({ error: "unknown settings panel" }, 404);
  });
  ctx.http.route("PUT", "/settings/:key", async (req, { params }) => {
    const provider = find(params.key ?? "");
    if (!provider) return json({ error: "unknown settings panel" }, 404);
    const body: unknown = await req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "body must be a JSON object" }, 400);
    }
    try {
      await provider.impl.set(body as Record<string, unknown>);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 422);
    }
    return json(await describe(provider));
  });
}
