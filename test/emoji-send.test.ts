import { expect, test } from "bun:test";
import { expandOutgoingEmoji } from "../src/app/emoji-send";

test("outgoing emoji preserve fenced code and link destinations", () => {
  const fenced = "```js\n:sob:\n```\n> ~~~\n> :sob:\n> ~~~";
  const url = "https://example.com/:sob:/path";
  expect(expandOutgoingEmoji(`${fenced}\n[:sob:](${url}) ${url} :sob:`)).toBe(
    `${fenced}\n[😭](${url}) ${url} 😭`,
  );
});
