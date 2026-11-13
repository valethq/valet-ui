// Minimal safe markdown: paragraphs, fenced code blocks, inline code.
// parseMarkdown is pure (unit-tested); renderMarkdown builds DOM via
// textContent only, so untrusted text can never become markup.

export type Inline = { type: "text"; text: string } | { type: "code"; text: string };
export type Block = { type: "p"; children: Inline[] } | { type: "pre"; text: string };

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    if (m.index > last) out.push({ type: "text", text: s.slice(last, m.index) });
    out.push({ type: "code", text: m[1] as string });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  const prose = (s: string): void => {
    for (const para of s.split(/\n{2,}/)) {
      if (para.trim() !== "") blocks.push({ type: "p", children: parseInline(para.trim()) });
    }
  };
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    prose(text.slice(last, m.index));
    blocks.push({ type: "pre", text: (m[1] as string).replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  prose(text.slice(last));
  return blocks;
}

export function renderMarkdown(text: string): HTMLElement {
  const root = document.createElement("div");
  for (const block of parseMarkdown(text)) {
    if (block.type === "pre") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text;
      pre.append(code);
      root.append(pre);
    } else {
      const p = document.createElement("p");
      for (const inline of block.children) {
        if (inline.type === "code") {
          const code = document.createElement("code");
          code.className = "inline";
          code.textContent = inline.text;
          p.append(code);
        } else {
          p.append(document.createTextNode(inline.text));
        }
      }
      root.append(p);
    }
  }
  return root;
}
