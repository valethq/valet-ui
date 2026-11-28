import { definePlugin } from "@valethq/sdk";
import { registerFiles } from "./files";
import { registerSettings } from "./settings";
import { startUiServer, type UiConfig, type UiServer } from "./server";
import { authorizeStreamRequest, registerStreamAuth } from "./stream-auth";

export default definePlugin<UiConfig>({
  async activate(ctx) {
    registerSettings(ctx);
    registerFiles(ctx);
    registerStreamAuth(ctx);
    const start = (config: UiConfig) =>
      startUiServer({ ...config, authorizeStream: (req) => authorizeStreamRequest(ctx, req) });
    let server: UiServer = await start(ctx.config);
    ctx.log.info("valet-ui listening", { url: server.url });
    ctx.onDispose(() => server.stop());
    ctx.onConfigChange(async (next, prev) => {
      server.stop();
      try {
        server = await start(next);
      } catch (error) {
        server = await start(prev);
        ctx.log.warn("valet-ui restored the previous server", { url: server.url });
        throw error;
      }
      ctx.log.info("valet-ui restarted", { url: server.url });
    });
  },
});
