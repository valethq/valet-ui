import { open, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PluginContext, RouteHandler } from "@valethq/sdk";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const SNIFF_BYTES = 8000;

const MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export type FileKind = "text" | "image" | "audio" | "video";

/** The media type the viewer can show for `path`, by extension; undefined for anything read as text. */
export const mediaType = (path: string): string | undefined => MEDIA[extname(path).slice(1).toLowerCase()];

export interface ProjectFile {
  /** Absolute, symlink-resolved path. */
  path: string;
  /** Slash-separated path from the project folder. */
  rel: string;
  /** The project folder's name. */
  root: string;
  size: number;
  kind: FileKind;
  /** Media files only; their bytes come from the raw route. */
  mime?: string;
  /** Text files only. */
  text?: string;
}

export class FileError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

interface Located {
  real: string;
  rel: string;
  root: string;
  size: number;
}

/** Resolves `input` (absolute, or relative to `workspaceDir`) to a regular file, refusing anything outside the folder. */
async function locate(workspaceDir: string, input: string): Promise<Located> {
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
  const info = await stat(real);
  if (!info.isFile()) throw new FileError(400, "Not a file");
  return { real, rel: relative(root, real).split(sep).join("/"), root: basename(root), size: info.size };
}

const tooLarge = () => new FileError(413, "This file is too large to show");

/** A text file with its contents, or a media file's kind and type (its bytes come from `openProjectMedia`). */
export async function readProjectFile(workspaceDir: string, input: string): Promise<ProjectFile> {
  const { real, rel, root, size } = await locate(workspaceDir, input);
  const base = { path: real, rel, root, size };
  const mime = mediaType(real);
  if (mime !== undefined) {
    if (size > MAX_MEDIA_BYTES) throw tooLarge();
    return { ...base, kind: mime.split("/")[0] as FileKind, mime };
  }
  if (size > MAX_FILE_BYTES) throw tooLarge();
  const handle = await open(real, "r");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(size);
    const { bytesRead } = await handle.read(bytes, 0, size, 0);
    bytes = bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) throw new FileError(415, "This is a binary file");
  return { ...base, size: bytes.length, kind: "text", text: new TextDecoder().decode(bytes) };
}

/** The bytes of an image, audio or video file, honouring a single `Range: bytes=` request so media can seek. */
export async function openProjectMedia(
  workspaceDir: string,
  input: string,
  range: string | null,
): Promise<Response> {
  const { real, size } = await locate(workspaceDir, input);
  const mime = mediaType(real);
  if (mime === undefined) throw new FileError(415, "Only images, audio and video are served raw");
  if (size > MAX_MEDIA_BYTES) throw tooLarge();
  const headers = new Headers({
    "content-type": mime,
    "cache-control": "no-store",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  });
  const file = Bun.file(real);
  const m = range === null ? null : /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m === null || (m[1] === "" && m[2] === "")) return new Response(file, { headers });
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  return new Response(file.slice(start, end + 1), { status: 206, headers });
}

/**
 * `GET /plugins/<id>/file?session=<id>&path=<path>`: a file from the session's project folder, as JSON.
 * `GET /plugins/<id>/file/raw?session=<id>&path=<path>`: the bytes of an image, audio or video file there.
 */
export function registerFiles(ctx: PluginContext): void {
  const serve =
    (answer: (workspaceDir: string, path: string, req: Request) => Promise<Response>): RouteHandler =>
    async (req, { principal, url }) => {
      if (principal?.role === "guest") return Response.json({ error: "Not allowed" }, { status: 403 });
      const session = ctx.store.sessions.get(url.searchParams.get("session") ?? "");
      const project = session === undefined ? undefined : ctx.store.projects.get(session.projectId);
      if (project === undefined) return Response.json({ error: "Unknown session" }, { status: 404 });
      try {
        return await answer(project.workspaceDir, url.searchParams.get("path") ?? "", req);
      } catch (error) {
        if (error instanceof FileError)
          return Response.json({ error: error.message }, { status: error.status });
        ctx.log.warn("valet-ui file read failed", { error: String(error) });
        return Response.json({ error: "Couldn't read this file" }, { status: 500 });
      }
    };
  ctx.http.route(
    "GET",
    "/file",
    serve(async (dir, path) =>
      Response.json(await readProjectFile(dir, path), { headers: { "cache-control": "no-store" } }),
    ),
  );
  ctx.http.route(
    "GET",
    "/file/raw",
    serve((dir, path, req) => openProjectMedia(dir, path, req.headers.get("range"))),
  );
}
