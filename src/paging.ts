/** Chat history is cut into fixed seq ranges so a page's bytes only change when its own messages do. */
export interface ChunkConfig {
  /** Messages per page. */
  chunkMessages: number;
  /** Most characters of one part's text or tool output sent in a piece. */
  partChars: number;
}

export const DEFAULT_CHUNK: ChunkConfig = { chunkMessages: 25, partChars: 8_000 };

const whole = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback;

export const chunkConfig = (c: Partial<ChunkConfig> = {}): ChunkConfig => ({
  chunkMessages: whole(c.chunkMessages, DEFAULT_CHUNK.chunkMessages, 5, 100),
  partChars: whole(c.partChars, DEFAULT_CHUNK.partChars, 500, 200_000),
});

/** What one round of a page may send: one full-size part for each message in the page. */
export const roundBudget = (c: ChunkConfig): number => c.chunkMessages * c.partChars;

/** Page `n` holds seq `n * size + 1` through `(n + 1) * size`; seqs start at 1. */
export const pageOf = (seq: number, size: number): number => Math.max(0, Math.floor((seq - 1) / size));
