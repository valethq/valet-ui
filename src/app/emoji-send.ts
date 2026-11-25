import { emoji } from "./emoji";

const FENCE = /^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/;
const INLINE = /\\[^\n]|(`+)|(?:https?:\/\/|www\.)[^\s<>]+|\]\([^\n]*?\)|:([a-z0-9_+-]{1,64}):/gi;

// spec-gap: outgoing shortcode expansion is a composer convention.
export function expandOutgoingEmoji(text: string): string {
  if (!text.includes(":")) return text;
  let fence: string | undefined;
  return text
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line);
      const run = marker?.[1];
      if (fence !== undefined) {
        if (
          run !== undefined &&
          run[0] === fence[0] &&
          run.length >= fence.length &&
          marker?.[2]?.trim() === ""
        ) {
          fence = undefined;
        }
        return line;
      }
      if (run !== undefined && (run[0] === "~" || !marker?.[2]?.includes("`"))) {
        fence = run;
        return line;
      }
      if (/^(?: {4}|\t)/.test(line)) return line;
      return expandLine(line);
    })
    .join("\n");
}

function expandLine(line: string): string {
  const tokens = new RegExp(INLINE);
  let result = "";
  let copied = 0;
  for (let match = tokens.exec(line); match !== null; match = tokens.exec(line)) {
    const ticks = match[1];
    if (ticks !== undefined) {
      const runs = /`+/g;
      runs.lastIndex = tokens.lastIndex;
      for (let end = runs.exec(line); end !== null; end = runs.exec(line)) {
        if (end[0].length !== ticks.length) continue;
        tokens.lastIndex = runs.lastIndex;
        break;
      }
    } else if (match[2] !== undefined) {
      const glyph = emoji.get(match[2]);
      if (glyph === undefined) continue;
      result += line.slice(copied, match.index) + glyph;
      copied = tokens.lastIndex;
    }
  }
  return result + line.slice(copied);
}
