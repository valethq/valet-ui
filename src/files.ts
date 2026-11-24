import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { PluginContext } from "@valethq/sdk";

export const MAX_FILE_BYTES = 1024 * 1024;
const SNIFF_BYTES = 8000;

export interface ProjectFile {
  /** Absolute, symlink-resolved path. */
  path: string;
  /** Slash-separated path from the project folder. */
  rel: string;
  /** The project folder's name. */
  root: string;
  size: number;
  text: string;
}

export class FileError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

/** Reads `input` (absolute, or relative to `workspaceDir`) as text, refusing anything that resolves outside the folder. */
export async function readProjectFile(workspaceDir: string, input: string): Promise<ProjectFile> {
  if (input.trim() === "" || input.includes("\0")) throw new FileError(400, "A file path is required");
  let root: string;
  try {
    root = await realpath(workspaceDir);
  } catch {
    throw new FileError(404, "The project folder no longer exists");
  }
  const outside = (p: string): boolean => {
    const rel = relative(root, p);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  };
  const requested = resolve(root, input);
  const denied = new FileError(403, "This file is outside the project folder");
  if (outside(requested)) throw denied;
  let real: string;
  try {
    real = await realpath(requested);
  } catch {
    throw new FileError(404, "File not found");
  }
  if (outside(real)) throw denied;
  const rel = relative(root, real);
  const info = await stat(real);
  if (!info.isFile()) throw new FileError(400, "Not a file");
  if (info.size > MAX_FILE_BYTES) throw new FileError(413, "This file is too large to show");
  const handle = await open(real, "r");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(info.size);
    const { bytesRead } = await handle.read(bytes, 0, info.size, 0);
    bytes = bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) throw new FileError(415, "This is a binary file");
  return {
    path: real,
    rel: rel.split(sep).join("/"),
    root: basename(root),
    size: bytes.length,
    text: new TextDecoder().decode(bytes),
  };
}

/** `GET /plugins/<id>/file?session=<id>&path=<path>`: a text file from the session's project folder. */
export function registerFiles(ctx: PluginContext): void {
  ctx.http.route("GET", "/file", async (_req, { principal, url }) => {
    if (principal?.role === "guest") return Response.json({ error: "Not allowed" }, { status: 403 });
    const session = ctx.store.sessions.get(url.searchParams.get("session") ?? "");
    const project = session === undefined ? undefined : ctx.store.projects.get(session.projectId);
    if (project === undefined) return Response.json({ error: "Unknown session" }, { status: 404 });
    try {
      return Response.json(await readProjectFile(project.workspaceDir, url.searchParams.get("path") ?? ""), {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      if (error instanceof FileError)
        return Response.json({ error: error.message }, { status: error.status });
      ctx.log.warn("valet-ui file read failed", { error: String(error) });
      return Response.json({ error: "Couldn't read this file" }, { status: 500 });
    }
  });
}
