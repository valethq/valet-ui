import { definePlugin } from "@valethq/sdk";
import { registerSettings } from "./settings";
import { startUiServer, type UiConfig, type UiServer } from "./server";

export default definePlugin<UiConfig>({
  async activate(ctx) {
    registerSettings(ctx);
    let server: UiServer = await startUiServer(ctx.config);
    ctx.log.info("valet-ui listening", { url: server.url });
    ctx.onDispose(() => server.stop());
    ctx.onConfigChange(async (next, prev) => {
      server.stop();
      try {
        server = await startUiServer(next);
      } catch (error) {
        server = await startUiServer(prev);
        ctx.log.warn("valet-ui restored the previous server", { url: server.url });
        throw error;
      }
      ctx.log.info("valet-ui restarted", { url: server.url });
    });
  },
});
