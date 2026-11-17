/** The browser-side switch for experimental features. It is a cookie, not localStorage, so the server sees it on page loads too. */
export const EXPERIMENTAL_COOKIE = "valet-ui-experimental";

export const hasExperimentalCookie = (cookieHeader: string): boolean =>
  cookieHeader.split(";").some((c) => c.trim() === `${EXPERIMENTAL_COOKIE}=1`);
