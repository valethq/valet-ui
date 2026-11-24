import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, RouteHandler } from "@valethq/sdk";
import { FileError, MAX_FILE_BYTES, readProjectFile, registerFiles } from "../src/files";

let base: string;
let root: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "valet-ui-files-"));
  root = join(base, "proj");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "const a = 1;\n");
  await writeFile(join(root, "bin.dat"), new Uint8Array([1, 0, 2]));
  await writeFile(join(root, "big.txt"), "x".repeat(MAX_FILE_BYTES + 1));
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
});

describe("GET /file", () => {
  let handler: RouteHandler;
  beforeAll(() => {
    const ctx = {
      store: {
        sessions: { get: (id: string) => (id === "s1" ? { id, projectId: "p1" } : undefined) },
        projects: { get: (id: string) => (id === "p1" ? { id, workspaceDir: root } : undefined) },
      },
      http: {
        route: (_m: string, _p: string, h: RouteHandler) => {
          handler = h;
        },
      },
      log: { warn() {} },
    } as unknown as PluginContext;
    registerFiles(ctx);
  });
  const call = (query: string, role = "owner") => {
    const url = new URL(`http://x/plugins/valet-ui/file?${query}`);
    return handler(new Request(url), {
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
});
