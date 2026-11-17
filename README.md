# valet-ui

Minimal web chat UI served on its own port (default 127.0.0.1:7418).

A [valet](https://github.com/valethq/valet-core) plugin. Imports `@valethq/sdk` only.

The browser only ever talks to this plugin's port. The plugin relays `/api/*`, `/plugins/*` and `/ws` to core (`coreUrl`, default `http://127.0.0.1:7417`), so core's port needn't be reachable from the device and the UI's origin needn't be in `server.allowedOrigins`.

## Experimental features

Settings has an **Experimental** tab, per browser. It sets the `valet-ui-experimental` cookie, which the server reads on every request, page loads included. While it is on:

- The page, the bundle and relayed API responses are brotli or gzip compressed when the client accepts it. Only finite text bodies of 1 KB or more are compressed; ranges, event streams and binaries pass through. The page and bundle carry a content-hash ETag and revalidate with a 304.

With it off, nothing is compressed and no cache headers are added.

## Settings panels

The Settings dialog has one tab per provider on the `settings` scope (`SettingsPanel` in `@valethq/sdk`). A panel can be a form, a read-only view, or both; the view renders above the form.

- **Form:** `schema` (a JSON-schema subset), `get()` and `set(values)`.
- **View:** `view()` returns blocks, re-read on every fetch. The UI renders them; a block is data, never markup. Types: `text`, `badge`, `stat`, `meter` (a bar with an optional pace `marker`), `table`, `button` and `group`. A malformed block, or one this UI is too old to know, is shown as JSON instead of breaking the panel. If `view()` throws, the panel shows the error and the form still works.
- **Refresh:** set `refreshMs` and the UI re-fetches the panel at that interval (never faster than 1s) while its tab is visible. Polling stops when the tab is hidden or the dialog is closed.
- **Actions:** a `button` block names a key in `actions`. The UI calls `POST /plugins/valet-ui/settings/:key/actions/:name` with the block's `args` as the JSON body, then re-renders the returned panel. Throw from the handler to show the message beside the button.
