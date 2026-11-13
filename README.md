# valet-ui

Minimal web chat UI served on its own port (default 127.0.0.1:7418).

A [valet](https://github.com/valethq/valet-core) plugin. Imports `@valethq/sdk` only.

The browser only ever talks to this plugin's port. The plugin relays `/api/*`, `/plugins/*` and `/ws` to core (`coreUrl`, default `http://127.0.0.1:7417`), so core's port needn't be reachable from the device and the UI's origin needn't be in `server.allowedOrigins`.
