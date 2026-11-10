/**
 * `@openllmsh/sdk/connect` — "Connect with OpenLLM" for your app's SERVER.
 *
 * Your users sign in with OpenLLM and run AI on their own account (their
 * subscriptions, devices and keys). This module holds your client secret and
 * private key: never import it into browser code.
 *
 *   const connect = createConnect({ store: encryptedConnectionStore(db, secret) });
 *   const routes = connectRoutes(connect, { userKey: (req) => sessionUserId(req) });
 *   // mount routes.start / routes.callback / routes.chat / routes.disconnect
 *
 *   const user = await connect.user(myUserId);
 *   const text = await user?.chat.stream({ model: "plus", messages });
 *
 * Guide: https://docs.openllm.sh/connect
 */
export * from "./chat";
export * from "./client";
export * from "./config";
export * from "./errors";
export * from "./oauth";
export * from "./routes";
export * from "./store";
