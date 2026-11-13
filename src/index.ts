import { definePlugin } from "@valethq/sdk";
import { startUiServer, type UiConfig } from "./server";

export default definePlugin<UiConfig>({
  async activate(ctx) {
    const server = await startUiServer(ctx.config);
    ctx.log.info("valet-ui listening", { url: server.url });
    ctx.onDispose(() => server.stop());
  },
});
