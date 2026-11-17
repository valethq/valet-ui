import { EXPERIMENTAL_COOKIE, hasExperimentalCookie } from "../experimental";
import type { SettingsEntry } from "./types";

export const EXPERIMENTAL_KEY = "ui-experimental";
const YEAR_SECONDS = 31_536_000;

export function cookieFor(enabled: boolean, secure: boolean): string {
  return `${EXPERIMENTAL_COOKIE}=${enabled ? "1" : "0"}; Path=/; Max-Age=${enabled ? YEAR_SECONDS : 0}; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export const experimentalEnabled = (): boolean => hasExperimentalCookie(document.cookie);

/** Per browser; features that need the server (compression) pick it up from the cookie on the next request. */
export function setExperimental(enabled: boolean): void {
  // biome-ignore lint/suspicious/noDocumentCookie: the string is built by cookieFor, and cookieStore is not in every browser
  document.cookie = cookieFor(enabled, location.protocol === "https:");
}

/** The tab is a local panel shaped like a plugin one, so it reuses the settings form. */
export function experimentalEntry(): SettingsEntry {
  return {
    key: EXPERIMENTAL_KEY,
    plugin: "valet-ui",
    pluginName: "Web UI",
    title: "Experimental",
    description:
      "Features still being tuned, stored in this browser only. Reload the page after changing it. Currently enables compressed responses (brotli or gzip) for the page and the API.",
    schema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          title: "Enable experimental features",
          description: "Turn this off if something misbehaves; the app works the same without it.",
        },
      },
    },
    values: { enabled: experimentalEnabled() },
  };
}

export function saveExperimental(values: Record<string, unknown>): SettingsEntry {
  setExperimental(values.enabled === true);
  return experimentalEntry();
}
