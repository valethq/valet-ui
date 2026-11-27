import { can, type AuthResult, type Caller, type PluginContext, ServiceDeniedError } from "@valethq/sdk";

/** Authenticates the UI server's own stream endpoints exactly like a control-plane request, then checks ui:stream.read. */
export async function authorizeStreamRequest(ctx: PluginContext, req: Request): Promise<boolean> {
  for (const provider of ctx.scopes.all("identity")) {
    let auth: AuthResult | undefined;
    try {
      auth = await provider.impl.authenticate(req);
    } catch (error) {
      if (error instanceof ServiceDeniedError) return false;
      ctx.log.error("identity provider failed", { plugin: provider.plugin, error: String(error) });
      continue;
    }
    if (auth === undefined) continue;
    const principal = ctx.store.principals.get(auth.principalId);
    if (principal === undefined) continue;
    const caller: Caller = {
      plugin: "core",
      actor: {
        principalId: principal.id,
        role: principal.role,
        ...(auth.tags === undefined ? {} : { tags: auth.tags }),
        ...(auth.cap === undefined ? {} : { cap: auth.cap }),
      },
      authenticatedBy: provider.key,
      ...(auth.credentialId === undefined ? {} : { credentialId: `${provider.key}:${auth.credentialId}` }),
      ...(auth.verifiedLogin === true ? { verifiedLogin: true } : {}),
    };
    return can(ctx, caller, "ui:stream.read").allow;
  }
  return false;
}
