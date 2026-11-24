import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, RouteHandler } from "@valethq/sdk";
import { FileError, MAX_FILE_BYTES, openProjectMedia, readProjectFile, registerFiles } from "../src/files";

let base: string;
let root: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "valet-ui-files-"));
  root = join(base, "proj");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "const a = 1;\n");
  await writeFile(join(root, "bin.dat"), new Uint8Array([1, 0, 2]));
  await writeFile(join(root, "big.txt"), "x".repeat(MAX_FILE_BYTES + 1));
  await writeFile(join(root, "pic.PNG"), new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3, 4, 5]));
  await writeFile(join(root, "big.png"), new Uint8Array(MAX_FILE_BYTES + 1));
  await writeFile(join(base, "secret.txt"), "nope");
  await symlink(join(base, "secret.txt"), join(root, "escape.txt"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: unknown) => (e instanceof FileError ? e.status : 500),
  );

describe("readProjectFile", () => {
  test("reads relative and absolute paths inside the folder", async () => {
    const rel = await readProjectFile(root, "src/a.ts");
    expect(rel).toMatchObject({ rel: "src/a.ts", root: "proj", size: 13, text: "const a = 1;\n" });
    expect((await readProjectFile(root, join(root, "src", "a.ts"))).rel).toBe("src/a.ts");
    expect((await readProjectFile(root, "src/../src/a.ts")).rel).toBe("src/a.ts");
  });

  test("refuses paths and symlinks that leave the folder", async () => {
    expect(await status(readProjectFile(root, "../secret.txt"))).toBe(403);
    expect(await status(readProjectFile(root, join(base, "secret.txt")))).toBe(403);
    expect(await status(readProjectFile(root, "../does-not-exist"))).toBe(403);
    expect(await status(readProjectFile(root, "escape.txt"))).toBe(403);
  });

  test("reports missing, directory, binary and oversized files", async () => {
    expect(await status(readProjectFile(root, "src/nope.ts"))).toBe(404);
    expect(await status(readProjectFile(root, "src"))).toBe(400);
    expect(await status(readProjectFile(root, ""))).toBe(400);
    expect(await status(readProjectFile(root, "bin.dat"))).toBe(415);
    expect(await status(readProjectFile(root, "big.txt"))).toBe(413);
  });

  test("describes images, audio and video by extension instead of reading them as text", async () => {
    const pic = await readProjectFile(root, "pic.PNG");
    expect(pic).toMatchObject({ rel: "pic.PNG", kind: "image", mime: "image/png", size: 10 });
    expect(pic.text).toBeUndefined();
    expect(await readProjectFile(root, "big.png")).toMatchObject({ kind: "image" });
    expect(await readProjectFile(root, "src/a.ts")).toMatchObject({ kind: "text" });
  });
});

describe("openProjectMedia", () => {
  test("serves the whole file, or the requested byte range", async () => {
    const whole = await openProjectMedia(root, "pic.PNG", null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("image/png");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await whole.arrayBuffer()).length).toBe(10);

    const part = await openProjectMedia(root, "pic.PNG", "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([78, 71, 0]);

    expect((await openProjectMedia(root, "pic.PNG", "bytes=7-")).headers.get("content-range")).toBe(
      "bytes 7-9/10",
    );
    expect((await openProjectMedia(root, "pic.PNG", "bytes=-3")).headers.get("content-range")).toBe(
      "bytes 7-9/10",
    );
    expect((await openProjectMedia(root, "pic.PNG", "bytes=20-")).status).toBe(416);
  });

  test("refuses text files and paths outside the folder", async () => {
    expect(await status(openProjectMedia(root, "src/a.ts", null))).toBe(415);
    expect(await status(openProjectMedia(root, "escape.txt", null))).toBe(403);
    expect(await status(openProjectMedia(root, "../secret.txt", null))).toBe(403);
  });
});

describe("GET /file", () => {
  const handlers = new Map<string, RouteHandler>();
  beforeAll(() => {
    const ctx = {
      store: {
        sessions: { get: (id: string) => (id === "s1" ? { id, projectId: "p1" } : undefined) },
        projects: { get: (id: string) => (id === "p1" ? { id, workspaceDir: root } : undefined) },
      },
      http: {
        route: (_m: string, p: string, h: RouteHandler) => {
          handlers.set(p, h);
        },
      },
      log: { warn() {} },
    } as unknown as PluginContext;
    registerFiles(ctx);
  });
  const call = (query: string, role = "owner", route = "/file") => {
    const url = new URL(`http://x/plugins/valet-ui${route}?${query}`);
    return (handlers.get(route) as RouteHandler)(new Request(url), {
      url,
      params: {},
      principal: { id: "u", displayName: "u", role: role as "owner" },
      caller: {} as never,
    });
  };

  test("serves a project file for a session", async () => {
    const res = await call("session=s1&path=src%2Fa.ts");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rel: "src/a.ts", text: "const a = 1;\n" });
  });

  test("refuses guests, unknown sessions and outside paths", async () => {
    expect((await call("session=s1&path=src%2Fa.ts", "guest")).status).toBe(403);
    expect((await call("session=nope&path=src%2Fa.ts")).status).toBe(404);
    const out = await call("session=s1&path=..%2Fsecret.txt");
    expect(out.status).toBe(403);
    expect(await out.json()).toEqual({ error: "This file is outside the project folder" });
  });

  test("serves media bytes on /file/raw with the same checks", async () => {
    const res = await call("session=s1&path=pic.PNG", "owner", "/file/raw");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await call("session=s1&path=pic.PNG", "guest", "/file/raw")).status).toBe(403);
    expect((await call("session=s1&path=src%2Fa.ts", "owner", "/file/raw")).status).toBe(415);
  });
});
