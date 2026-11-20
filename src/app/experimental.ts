import { EXPERIMENTAL_COOKIE, hasExperimentalCookie } from "../experimental";

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
