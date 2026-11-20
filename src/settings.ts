import type { PluginContext, ScopeProvider, SettingsBlock } from "@valethq/sdk";

export interface SettingsEntry {
  key: string;
  plugin: string;
  title: string;
  description?: string;
  schema?: Record<string, unknown>;
  values?: Record<string, unknown>;
  blocks?: SettingsBlock[];
  /** Set when the panel's `view()` threw; the rest of the entry is still usable. */
  viewError?: string;
  refreshMs?: number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function describe(p: ScopeProvider<"settings">): Promise<SettingsEntry> {
  const { impl } = p;
  const [values, view] = await Promise.all([
    impl.get?.(),
    impl.view
      ? Promise.resolve()
          .then(() => impl.view?.())
          .then(
            (blocks) => ({ blocks }),
            (error: unknown) => ({ viewError: message(error) }),
          )
      : undefined,
  ]);
  return {
    key: p.key,
    plugin: p.plugin,
    title: impl.title,
    ...(impl.description && { description: impl.description }),
    ...(impl.page && { page: impl.page }),
    ...(impl.schema && { schema: impl.schema }),
    ...(values && { values }),
    ...view,
    ...(impl.refreshMs && { refreshMs: impl.refreshMs }),
  };
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
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
    if (!provider.impl.set) return json({ error: "this panel has no editable values" }, 405);
    const body = parseObject(await req.text());
    if (!body) return json({ error: "body must be a JSON object" }, 400);
    try {
      await provider.impl.set(body);
    } catch (error) {
      return json({ error: message(error) }, 422);
    }
    return json(await describe(provider));
  });
  ctx.http.route("POST", "/settings/:key/actions/:name", async (req, { params }) => {
    const provider = find(params.key ?? "");
    if (!provider) return json({ error: "unknown settings panel" }, 404);
    const name = params.name ?? "";
    const action = Object.hasOwn(provider.impl.actions ?? {}, name)
      ? provider.impl.actions?.[name]
      : undefined;
    if (!action) return json({ error: "unknown action" }, 404);
    const text = await req.text();
    const args = text.trim() === "" ? {} : parseObject(text);
    if (!args) return json({ error: "body must be a JSON object" }, 400);
    try {
      await action(args);
    } catch (error) {
      return json({ error: message(error) }, 422);
    }
    return json(await describe(provider));
  });
}
