# Rules for this repo (a valet plugin)

- Runtime Bun 1.4.4 (`~/.npm-global/bin/bun`). Strict TypeScript. No new npm dependencies.
- Import only `@valethq/sdk` plus `node:*` / `bun:*` builtins. Never import `@valethq/core`, another plugin, or any file under `../valet-core` or `../valet-*`. No private APIs, no `ctx.internal`-style bypasses: everything goes through the `PluginContext` the kernel passes to `activate`.
- The contract is `../valet-core/docs/ARCHITECTURE.md` (normative) and the SDK types in `../valet-core/packages/sdk/src/*.ts`. Read them; do not guess signatures. You may read `../valet-core/packages/core/src/**` to understand behaviour, never import it.
- Another valet plugin's scope types are redeclared locally by module augmentation (`declare module "@valethq/sdk" { interface ValetScopes { context: ContextManager } }`), copied from the architecture doc.
- Checks, all green before you finish: `bun run typecheck`, `bun run lint` (fix with `bunx biome check --write .`), and `flock /tmp/example-heavy.lock bun test`.
- Tests live in `test/`. Unit tests use a small fake `PluginContext`. To boot the real kernel in a test, spawn `bun /home/user/valet/valet-core/packages/core/src/cli.ts start --home <tmpdir>` (write `<tmpdir>/config.json` with a free `server.port`, `pluginPaths`, and `plugins.<id>.config`), poll `GET http://127.0.0.1:<port>/` until 200, and kill it in `afterAll`.
- Small files, minimal comments, no dead code. Keep the existing `package.json` scripts, `tsconfig.json` and `biome.json`.
- Do not commit, push, or touch anything outside this repo. Do not touch `~/.openclaw`. Do not kill processes you did not start. Do not start long-running servers except inside tests.
- Finish with a short summary of what you built and the check results.
