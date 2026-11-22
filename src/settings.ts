import type {
  Display,
  PanelField,
  PluginContext,
  RuntimeSubsection,
  ScopeProvider,
  SettingsContribution,
} from "@valethq/sdk";

/** A runtime subsection as the browser sees it: no functions, masked values never echoed. */
export interface RuntimeView {
  id: string;
  label: string;
  summary?: string;
  order?: number;
  section?: string;
  items: (PanelField | Display)[];
  refreshMs?: number;
  values?: Record<string, unknown>;
  editable: boolean;
}

/** One plugin's settings@2 contribution (12.1 Runtime). */
export interface ContributionView {
  plugin: string;
  options: string[];
  views: string[];
  actions: string[];
  subsections: RuntimeView[];
  /** Set when subsections() threw; the rest still works. */
  error?: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const MIN_REFRESH_MS = 1000;

const isField = (item: PanelField | Display): item is PanelField => "input" in item;

/** Values a subsection's get() returned, minus masked fields (their stored value never goes back out). */
function visibleValues(sub: RuntimeSubsection, values: Record<string, unknown>): Record<string, unknown> {
  const masked = new Set(
    sub.items
      .filter(isField)
      .filter((f) => f.input.masked === true)
      .map((f) => f.id),
  );
  return Object.fromEntries(Object.entries(values).filter(([k]) => !masked.has(k)));
}

async function viewOf(sub: RuntimeSubsection): Promise<RuntimeView> {
  const values = sub.get ? visibleValues(sub, await sub.get()) : undefined;
  return {
    id: sub.id,
    label: sub.label,
    ...(sub.summary === undefined ? {} : { summary: sub.summary }),
    ...(sub.order === undefined ? {} : { order: sub.order }),
    ...(sub.section === undefined ? {} : { section: sub.section }),
    items: sub.items,
    ...(sub.refreshMs === undefined ? {} : { refreshMs: Math.max(MIN_REFRESH_MS, sub.refreshMs) }),
    ...(values === undefined ? {} : { values }),
    editable: sub.set !== undefined,
  };
}

async function describe(p: ScopeProvider<"settings">): Promise<ContributionView> {
  const { impl } = p;
  const base = {
    plugin: p.plugin,
    options: Object.keys(impl.options ?? {}),
    views: Object.keys(impl.views ?? {}),
    actions: Object.keys(impl.actions ?? {}),
  };
  try {
    const subs = (await impl.subsections?.()) ?? [];
    return { ...base, subsections: await Promise.all(subs.map(viewOf)) };
  } catch (error) {
    return { ...base, subsections: [], error: message(error) };
  }
}

function parseObject(text: string): Record<string, unknown> | undefined {
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

type Named = "options" | "views" | "actions";

/** A handler of the plugin's contribution by name, never one inherited from Object.prototype. */
function handler(impl: SettingsContribution, kind: Named, name: string) {
  const table = impl[kind] as Record<string, (args: Record<string, unknown>) => unknown> | undefined;
  return table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
}

/** settings@2: valet-ui defines the scope and relays each plugin's options, views, actions and runtime subsections. */
export function registerSettings(ctx: PluginContext): void {
  ctx.scopes.define({ name: "settings", version: 2, cardinality: "many" });
  const find = (plugin: string) => ctx.scopes.all("settings").find((p) => p.plugin === plugin);

  const read = { permission: "ui:settings.read", resource: pluginResource };
  const write = { permission: "ui:settings.write", resource: pluginResource };
  // spec-gap: the list is not filtered per plugin; it needs the unscoped ui:settings.read.
  ctx.http.route(
    "GET",
    "/settings",
    async () => json(await Promise.all(ctx.scopes.all("settings").map(describe))),
    { permission: "ui:settings.read" },
  );
  ctx.http.route(
    "GET",
    "/settings/:plugin",
    async (_req, { params }) => {
      const provider = find(params.plugin ?? "");
      return provider ? json(await describe(provider)) : json({ error: "Unknown plugin" }, 404);
    },
    read,
  );

  for (const kind of ["options", "views", "actions"] as const) {
    ctx.http.route(
      "POST",
      `/settings/:plugin/${kind}/:name`,
      async (req, { params }) => {
        const provider = find(params.plugin ?? "");
        if (!provider) return json({ error: "Unknown plugin" }, 404);
        const fn = handler(provider.impl, kind, params.name ?? "");
        if (!fn) return json({ error: `Unknown ${kind.slice(0, -1)}` }, 404);
        const args = parseObject(await req.text());
        if (!args) return json({ error: "Request body must be a JSON object" }, 400);
        try {
          const result = await fn(args);
          return kind === "actions" ? json(await describe(provider)) : json(result ?? null);
        } catch (error) {
          return json({ error: message(error) }, 422);
        }
      },
      kind === "actions" ? write : read,
    );
  }

  ctx.http.route(
    "PUT",
    "/settings/:plugin/subsections/:id",
    async (req, { params }) => {
      const provider = find(params.plugin ?? "");
      if (!provider) return json({ error: "Unknown plugin" }, 404);
      const sub = ((await provider.impl.subsections?.()) ?? []).find((s) => s.id === params.id);
      if (!sub) return json({ error: "Unknown subsection" }, 404);
      if (!sub.set) return json({ error: "This subsection has no editable values" }, 405);
      const body = parseObject(await req.text());
      if (!body) return json({ error: "Request body must be a JSON object" }, 400);
      try {
        await sub.set(body);
      } catch (error) {
        return json({ error: message(error) }, 422);
      }
      return json(await describe(provider));
    },
    write,
  );
}

/** `/settings/:plugin/...` -> `plugin:<id>`, the resource core checks the route permission on. */
function pluginResource(req: Request) {
  return { id: `plugin:${decodeURIComponent(new URL(req.url).pathname.split("/")[4] ?? "")}` };
}
