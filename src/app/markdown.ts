// Safe markdown for chat: CommonMark core (nested lists and quotes, fences,
// setext/ATX headings, emphasis, links, references, autolinks, escapes,
// entities), plus GFM tables, task lists, strikethrough, bare URLs and
// footnotes. Raw HTML and images stay inert (shown as text / as links).

export type { Block, ListItem, TableAlign } from "./md-blocks";
export { parseMarkdown } from "./md-blocks";
export type { Inline, LinkDef, MdContext } from "./md-inline";
export { renderMarkdown } from "./md-render";
