// Control-plane wire types, mirrored from @valethq/sdk (the browser bundle
// stays hermetic; these are the fields the UI reads).

export interface Project {
  id: string;
  name: string;
  workspaceDir: string;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  projectId: string;
  title: string | null;
  color: string | null;
  parentSessionId: string | null;
  status: "idle" | "running" | "archived";
  settings: SessionSettings;
  providerState: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
  lastResponseAt: number | null;
}

export interface SessionSettings {
  model?: {
    provider: string;
    model: string;
    effort?: string;
    fast?: boolean;
    fallbacks?: { provider: string; model: string; effort?: string; fast?: boolean }[];
  };
  [key: string]: unknown;
}

/** GET /plugins/valet-agent/sessions/:id/state. */
export interface SessionState {
  activeRunId?: string;
  queued: number;
  model: { provider: string; model: string; effort?: string; fast?: boolean };
  usage?: Record<string, number>;
}

export interface Run {
  id: string;
  sessionId: string;
  triggerMessageId: string | null;
  status: "queued" | "running" | "complete" | "cancelled" | "error" | "interrupted";
  role: string;
  provider: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  /** Not part of the SDK Run row today; read defensively (usage.contextTokens). */
  usage?: Record<string, number>;
}

export interface Message {
  id: string;
  sessionId: string;
  seq: number;
  role: "user" | "assistant" | "system" | "tool";
  authorPrincipalId: string | null;
  runId: string | null;
  status: "streaming" | "complete" | "error" | "interrupted";
  origin: unknown;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type PartData =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      callId: string;
      name: string;
      title?: string;
      input: unknown;
      output?: string;
      result?: unknown;
      status: "pending" | "running" | "done" | "error" | "cancelled" | "denied";
    }
  | { type: "file"; blobId: string; name: string; mime: string }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | {
      type: "compaction";
      by: string;
      status: "in_progress" | "completed" | "failed" | "cancelled";
      coversThroughSeq: number;
      summary?: string;
      error?: string;
    }
  | { type: "custom"; kind: string; title: string; text: string; data: unknown };

export interface Part {
  id: string;
  messageId: string;
  idx: number;
  status: "streaming" | "complete" | "error" | "interrupted";
  type: PartData["type"];
  data: PartData;
  /** Set while the part's text or tool output is still arriving in pieces: its full length. */
  partial?: number;
  createdAt: number;
  updatedAt: number;
}

export type PartInput = Extract<PartData, { type: "text" | "file" }>;

export interface ChatMessage {
  message: Message;
  parts: Part[];
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  efforts?: string[];
  defaultEffort?: string;
  fast?: boolean;
  fastByDefault?: boolean;
  hidden?: boolean;
  /** Catalog: false → omitted from the picker. */
  show?: boolean;
  /** Added by hand in valet-agent's models config. */
  custom?: boolean;
}

export interface ProviderModels {
  provider: string;
  label: string;
  /** The provider's logo key (ProviderBase.icon), when its plugin names one. */
  icon?: string;
  models: ModelInfo[];
}

/** One row of core's GET /api/core/plugins (mirrors PluginStatus in valet-core kernel.ts). */
export interface PluginStatus {
  id: string;
  name?: string;
  version?: string;
  state: "active" | "failed" | "disabled";
  error?: string;
}

/** One entry of core's GET /api/core/part-types (mirrors PartType in the SDK's parttypes.ts, 9.4). */
export interface PartType {
  id: string;
  description?: string;
  view?: { collapsed?: boolean; level?: "info" | "warn" | "error"; icon?: string; fields?: string[] };
  plugin: { id: string; version: string; repository?: string };
  /** Whether the defining plugin is active; set by listPartTypes when core's plugin list loads. */
  loaded?: boolean;
}

// ---- settings v3 (12.1), mirrored from @valethq/sdk settings.ts ----

export type SettingsGroup = "system" | "inference" | "tools";
export type Tone = "normal" | "good" | "warning" | "critical";
export type Path = string;
export type Cond =
  | { eq: [Path, unknown] }
  | { ne: [Path, unknown] }
  | { in: [Path, unknown[]] }
  | { set: Path }
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] };

export interface OptionDef {
  value: string;
  label?: string;
  summary?: string;
  icon?: string;
  group?: string;
}
export type Args = Record<string, unknown>;
export type OptionsDef = OptionDef[] | { from: string; args?: Args };

/** An input: `type` plus whatever fields its type takes (validated by core, read loosely here). */
export interface InputDef {
  type: string;
  id?: string;
  label?: string;
  summary?: string;
  default?: unknown;
  required?: boolean;
  readonly?: boolean;
  when?: Cond;
  refs?: string[];
  [field: string]: unknown;
}

export interface SettingDef {
  id: string;
  label: string;
  summary?: string;
  details?: string;
  input: InputDef;
  when?: Cond;
  scopes?: ("user" | "project")[];
  apply?: "live" | "restart";
  advanced?: boolean;
  deprecated?: string;
  keywords?: string[];
}

/** A display item: stores nothing. Fields by type (heading, note, divider, link, badge, stat, meter, table, action). */
export interface DisplayDef {
  type: string;
  id?: string;
  when?: Cond;
  from?: string;
  args?: Args;
  [field: string]: unknown;
}

export type ItemDef = SettingDef | DisplayDef;

export interface SubsectionDef {
  id: string;
  label: string;
  summary?: string;
  order?: number;
  items: ItemDef[];
}

export interface SectionDef {
  icon?: string;
  order?: number;
  subsections: SubsectionDef[];
}

export interface SettingsDoc {
  sections: Partial<Record<SettingsGroup, SectionDef>>;
  types?: Record<string, { base: string; [field: string]: unknown }>;
}

export type SettingSource = "default" | "file" | "settings" | "project";

/** One plugin's settings as GET /api/core/settings serves them (12.1 PluginSettings). */
export interface CorePluginSettings {
  plugin: string;
  name?: string;
  description?: string;
  version?: string;
  provides: string[];
  state: "active" | "failed" | "disabled" | "pending";
  enabled: boolean;
  settings?: SettingsDoc;
  types?: Record<string, { base: string; [field: string]: unknown }>;
  schema?: Record<string, unknown>;
  values: Record<string, unknown>;
  sources: Record<string, SettingSource>;
  layers?: {
    file?: Record<string, unknown>;
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
  liveConfig?: boolean;
  issues?: Record<string, string>;
  restartRequired?: string;
}

/** A settings@2 runtime subsection as valet-ui's relay serves it (mirrors src/settings.ts). */
export interface RuntimeView {
  id: string;
  label: string;
  summary?: string;
  order?: number;
  section?: SettingsGroup;
  items: ItemDef[];
  refreshMs?: number;
  values?: Record<string, unknown>;
  editable: boolean;
}

/** One plugin's settings@2 contribution (mirrors src/settings.ts). */
export interface ContributionView {
  plugin: string;
  options: string[];
  views: string[];
  actions: string[];
  subsections: RuntimeView[];
  error?: string;
}

export type SecretSource = "file" | "env" | null;

export interface SecretMeta {
  name: string;
  source: SecretSource;
}

// ---- WS frames (10.3) ----

export type ClientFrame =
  | { type: "sub"; topics: string[]; since?: Record<string, number> }
  | { type: "unsub"; topics: string[] }
  | { type: "ping" };

export type ServerFrame =
  | { type: "event"; topic: string; seq: number; name: string; data: unknown }
  | { type: "result"; id: string; ok: boolean; data?: unknown; error?: { code: string; message: string } }
  | { type: "gap"; topic: string }
  | { type: "pong" };

// ---- event payloads published on session:<id> / sessions:<projectId> ----

export interface MessageDelta {
  sessionId: string;
  messageId: string;
  partId: string;
  kind: "text" | "reasoning" | "tool-output";
  /** Length of the part's text/output before this delta (exact streaming). */
  offset?: number;
  delta: string;
}

export interface RunStatus {
  sessionId: string;
  runId: string;
  status: string;
}
