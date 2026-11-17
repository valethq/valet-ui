# valet-ui

Minimal web chat UI served on its own port (default 127.0.0.1:7418).

A [valet](https://github.com/valethq/valet-core) plugin. Imports `@valethq/sdk` only.

The browser only ever talks to this plugin's port. The plugin relays `/api/*`, `/plugins/*` and `/ws` to core (`coreUrl`, default `http://127.0.0.1:7417`), so core's port needn't be reachable from the device and the UI's origin needn't be in `server.allowedOrigins`.

## Experimental features

Settings has an **Experimental** tab, per browser. It sets the `valet-ui-experimental` cookie, which the server reads on every request, page loads included. While it is on:

- The page, the bundle and relayed API responses are brotli or gzip compressed when the client accepts it. Only finite text bodies of 1 KB or more are compressed; ranges, event streams and binaries pass through. The page and bundle carry a content-hash ETag and revalidate with a 304.

- Chats open in pages instead of one 200-message fetch. The browser asks the plugin for `/ui/messages/:id` (the newest page) and `/ui/messages/:id?page=n`; the plugin reads core over loopback and cuts history into fixed pages of 25 messages by seq. A page's ETag is a hash of its own bytes, so a sealed page keeps its ETag as the chat grows and revalidates to a 304. Core and its API are unchanged.
- The page cache lives in IndexedDB (about 300 pages, least recently written evicted first; cleared on logout and per chat on delete). Opening a chat paints the cached newest page at once, then confirms it with a conditional request.
- Older pages load while less than 1.5 screens of messages sit above the viewport, so a chat always has at least two screens loaded. The check measures the real layout, so zoom, font size and width are accounted for. The scroll position is kept in place as older pages are added above.
- If the paged route fails, a cached paint stays on screen; with nothing cached the chat falls back to the whole-window fetch.

- Long parts arrive in pieces. A page's first response gives every part of what the model said (text, reasoning) and of tool output at most `partChars` characters, and marks a short one with its full length (`partial`). The page paints at once; the browser then pulls the rest in rounds (`?page=n&round=k&v=<etag>`), each round spending up to `chunkMessages x partChars` characters, what the model said before tool output and the newest message first. The page is stored in the device cache whole once the last piece lands. A round answers 409 if the page changed since its ETag, and the chat refetches. Messages and parts still streaming are never cut.

Both knobs are config only, under `plugins["valet-ui"].config`: `chunkMessages` (messages per page, default 25, 5 to 100) and `partChars` (default 8000, 500 to 200000). They apply when the plugin restarts, and cached pages from the old values simply revalidate.

With it off, nothing is compressed, no cache headers are added, and chats load the way they always did.

## Settings panels

The Settings dialog has one tab per provider on the `settings` scope (`SettingsPanel` in `@valethq/sdk`). A panel can be a form, a read-only view, or both; the view renders above the form.

- **Form:** `schema` (a JSON-schema subset), `get()` and `set(values)`.
- **View:** `view()` returns blocks, re-read on every fetch. The UI renders them; a block is data, never markup. Types: `text`, `badge`, `stat`, `meter` (a bar with an optional pace `marker`), `table`, `button` and `group`. A malformed block, or one this UI is too old to know, is shown as JSON instead of breaking the panel. If `view()` throws, the panel shows the error and the form still works.
- **Refresh:** set `refreshMs` and the UI re-fetches the panel at that interval (never faster than 1s) while its tab is visible. Polling stops when the tab is hidden or the dialog is closed.
- **Actions:** a `button` block names a key in `actions`. The UI calls `POST /plugins/valet-ui/settings/:key/actions/:name` with the block's `args` as the JSON body, then re-renders the returned panel. Throw from the handler to show the message beside the button.
