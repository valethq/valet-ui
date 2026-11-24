// What was typed in the composer, kept per session (or for the new-chat page) across switches and reloads.

const PREFIX = "valet-ui.draft.";
const NEW = "new";

const keyOf = (sessionId: string | null): string => PREFIX + (sessionId ?? NEW);

export function loadDraft(sessionId: string | null): string {
  try {
    return localStorage.getItem(keyOf(sessionId)) ?? "";
  } catch {
    return "";
  }
}

/** An empty or whitespace-only draft is removed rather than stored. */
export function saveDraft(sessionId: string | null, text: string): void {
  try {
    if (text.trim() === "") localStorage.removeItem(keyOf(sessionId));
    else localStorage.setItem(keyOf(sessionId), text);
  } catch {
    // storage full or blocked; the draft lasts until the page closes
  }
}
