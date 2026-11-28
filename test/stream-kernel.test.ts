import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { Subprocess } from "bun";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CORE = process.env.VALET_CORE_DIR ?? join(import.meta.dir, "..", "..", "valet-core");
const CORE_CLI = join(CORE, "packages/core/src/cli.ts");
const SDK_DIR = join(CORE, "packages/sdk");
const UI_REPO = join(import.meta.dir, "..");
const AUTH_REPO = join(import.meta.dir, "..", "..", "valet-auth");
const BUN = Bun.which("bun") ?? join(homedir(), ".npm-global/bin/bun");

setDefaultTimeout(25_000);

let home: string;
let coreBase: string;
let uiBase: string;
let proc: Subprocess | undefined;
let output = "";
let rfb: Server;
let rfbPort = 0;

function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = srv.port ?? 0;
  srv.stop(true);
  return port;
}

function stagePlugin(pluginsDir: string, id: string, repo: string, novnc = false): void {
  const dest = join(pluginsDir, id);
  mkdirSync(join(dest, "node_modules", "@valethq"), { recursive: true });
  cpSync(join(repo, "src"), join(dest, "src"), { recursive: true });
  cpSync(join(repo, "manifest.json"), join(dest, "manifest.json"));
  symlinkSync(SDK_DIR, join(dest, "node_modules", "@valethq", "sdk"));
  if (novnc) {
    mkdirSync(join(dest, "node_modules", "@novnc"), { recursive: true });
    symlinkSync(join(repo, "node_modules", "@novnc", "novnc"), join(dest, "node_modules", "@novnc", "novnc"));
  }
}

const post = (base: string, path: string, body: unknown, cookie?: string) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "valet-ui-stream-kernel-"));
  const pluginsDir = join(home, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  stagePlugin(pluginsDir, "valet-auth", AUTH_REPO);
  stagePlugin(pluginsDir, "valet-ui", UI_REPO, true);

  rfb = createServer((socket) => socket.write("RFB 003.008\n"));
  await new Promise<void>((resolve) => rfb.listen(0, "127.0.0.1", resolve));
  rfbPort = (rfb.address() as { port: number }).port;

  const corePort = freePort();
  const uiPort = freePort();
  coreBase = `http://127.0.0.1:${corePort}`;
  uiBase = `http://127.0.0.1:${uiPort}`;
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      server: { host: "127.0.0.1", port: corePort, allowedOrigins: [] },
      pluginPaths: [pluginsDir],
      plugins: {
        "valet-auth": { enabled: true, config: {} },
        "valet-ui": {
          enabled: true,
          config: { host: "127.0.0.1", port: uiPort, coreUrl: coreBase },
        },
      },
    }),
  );
  proc = Bun.spawn([BUN, CORE_CLI, "start", "--home", home], { stdout: "pipe", stderr: "pipe" });
  const drain = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    for await (const chunk of stream) output += Buffer.from(chunk).toString("utf8");
  };
  void drain(proc.stdout as ReadableStream<Uint8Array>);
  void drain(proc.stderr as ReadableStream<Uint8Array>);

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`valet exited ${proc.exitCode}\n${output}`);
    try {
      if ((await fetch(`${coreBase}/`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`valet did not start\n${output}`);
    await Bun.sleep(100);
  }
});

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  rfb?.close();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

test("a UI login cookie authorizes the stream probe", async () => {
  const token = readFileSync(join(home, "data", "valet-auth", "setup-token"), "utf8");
  const setup = await post(coreBase, "/plugins/valet-auth/setup", {
    token,
    password: "correct horse battery staple",
    displayName: "Test Owner",
  });
  expect(setup.status).toBe(200);
  const setCookie = setup.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";", 1)[0] as string;
  expect(cookie).toMatch(/^valet_session=/);
  expect((await fetch(`${coreBase}/api/core/projects`, { headers: { cookie } })).status).toBe(200);

  const probe = await fetch(`${uiBase}/stream/vnc/127.0.0.1/${rfbPort}/probe`, {
    headers: { cookie },
  });
  expect(probe.status).toBe(200);
  expect(await probe.json()).toEqual({ ok: true, version: "003.008" });
});
