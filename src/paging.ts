/** Chat history is cut into fixed seq ranges so a page's bytes only change when its own messages do. */
export const PAGE_SIZE = 25;

/** Page `n` holds seq `n * PAGE_SIZE + 1` through `(n + 1) * PAGE_SIZE`; seqs start at 1. */
export const pageOf = (seq: number): number => Math.max(0, Math.floor((seq - 1) / PAGE_SIZE));
