import { afterEach, describe, expect, test } from "bun:test";
import { createProject, deleteProject, listDirs, makeDir, updateProject } from "../src/app/api";
import { crumbs } from "../src/app/views/folder-browser";

const g = globalThis as Record<string, unknown>;
const realFetch = g.fetch;
afterEach(() => {
  g.fetch = realFetch;
});

function record(): { calls: { method: string; url: string; body: unknown }[] } {
  const calls: { method: string; url: string; body: unknown }[] = [];
  g.fetch = ((url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls };
}

describe("crumbs", () => {
  test("collapses the home directory to ~", () => {
    expect(crumbs("/home/u/code/app", "/home/u")).toEqual([
      { name: "~", path: "/home/u" },
      { name: "code", path: "/home/u/code" },
      { name: "app", path: "/home/u/code/app" },
    ]);
  });
  test("starts at / outside home, and a sibling of home is not under it", () => {
    expect(crumbs("/srv/x", "/home/u")).toEqual([
      { name: "/", path: "/" },
      { name: "srv", path: "/srv" },
      { name: "x", path: "/srv/x" },
    ]);
    expect(crumbs("/home/user2", "/home/u")[0]).toEqual({ name: "/", path: "/" });
    expect(crumbs("/", "/home/u")).toEqual([{ name: "/", path: "/" }]);
  });
});

describe("project and folder api calls", () => {
  test("hit the core routes with encoded paths and JSON bodies", async () => {
    const { calls } = record();
    await listDirs("/a b");
    await listDirs();
    await makeDir("/a", "new");
    await createProject("/a/new");
    await createProject("/a/new", "Named");
    await updateProject("prj_1", { workspaceDir: "/b" });
    await deleteProject("prj_1");
    expect(calls).toEqual([
      { method: "GET", url: "/api/core/fs/list?path=%2Fa%20b", body: undefined },
      { method: "GET", url: "/api/core/fs/list", body: undefined },
      { method: "POST", url: "/api/core/fs/mkdir", body: { parent: "/a", name: "new" } },
      { method: "POST", url: "/api/core/projects", body: { workspaceDir: "/a/new" } },
      { method: "POST", url: "/api/core/projects", body: { workspaceDir: "/a/new", name: "Named" } },
      { method: "PATCH", url: "/api/core/projects/prj_1", body: { workspaceDir: "/b" } },
      { method: "DELETE", url: "/api/core/projects/prj_1", body: undefined },
    ]);
  });
});
