import type { TChatParams } from "./chat";
import { encodeTextStream } from "./chat";
import type { TConnect, TConnectedUser } from "./client";
import { isOpenLLMError, OpenLLMError } from "./errors";
import type { TPendingConnect } from "./oauth";

/**
 * Ready-made `(Request) => Response` handlers for the whole connect flow. They
 * are plain Fetch API handlers, so they mount as-is in Next.js route handlers,
 * Hono, Bun.serve, Deno, Remix, SvelteKit or Workers.
 */
export type ConnectRoutesParams = {
  /**
   * Who is this in YOUR app (user id or session id). Return `null` when
   * nobody is signed in to your app; the handlers answer 401.
   */
  readonly userKey: (req: Request) => string | null | Promise<string | null>;
  /** Where `callback` sends the browser afterwards (default `/`). */
  readonly returnTo?: string;
  /** Cookie that carries state + PKCE between start and callback. */
  readonly cookieName?: string;
};

export type TConnectRoutes = {
  /** GET: redirect to OpenLLM's consent screen. */
  readonly start: (req: Request) => Promise<Response>;
  /** GET: the registered callback URL. Redirects to `returnTo`, `?error=` on failure. */
  readonly callback: (req: Request) => Promise<Response>;
  /** POST: revoke and forget. */
  readonly disconnect: (req: Request) => Promise<Response>;
  /** POST `{ model, messages }`: one chat turn, streamed back as plain text. */
  readonly chat: (req: Request) => Promise<Response>;
  /** GET: `{ connected, userId, models }` for the signed-in user. */
  readonly status: (req: Request) => Promise<Response>;
};

export const DEFAULT_CONNECT_COOKIE = "openllm_connect";
const COOKIE_MAX_AGE_S = 600;

const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    // The browser controls this value: a malformed escape is no cookie.
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

const cookieHeader = (
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string =>
  [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");

const parsePending = (raw: string | null): TPendingConnect | null => {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<TPendingConnect>;
    return typeof value.state === "string" &&
      typeof value.codeVerifier === "string"
      ? { state: value.state, codeVerifier: value.codeVerifier }
      : null;
  } catch {
    return null;
  }
};

/**
 * An `OpenLLMError` as the `{ error: { code, message } }` JSON OpenLLM uses.
 * Any other failure answers a fixed message: its text can carry internals
 * (paths, hosts, config) and these responses reach the browser. The original
 * is logged server-side.
 */
export const errorResponse = (err: unknown): Response => {
  if (!isOpenLLMError(err)) console.error("[openllm/connect]", err);
  const e = isOpenLLMError(err)
    ? err
    : new OpenLLMError(500, "openllm_error", "Something went wrong");
  const headers: Record<string, string> = {};
  if (e.retryAfter !== null) headers["retry-after"] = String(e.retryAfter);
  return Response.json(
    { error: { code: e.code, message: e.message } },
    { status: e.status, headers },
  );
};

const notSignedIn = (): Response =>
  errorResponse(
    new OpenLLMError(401, "not_connected", "Sign in to this app first"),
  );

export const connectRoutes = (
  connect: TConnect,
  params: ConnectRoutesParams,
): TConnectRoutes => {
  const cookie = params.cookieName ?? DEFAULT_CONNECT_COOKIE;
  const returnTo = params.returnTo ?? "/";
  const secure = (): boolean => connect.config.redirectUri.startsWith("https:");

  const back = (req: Request, error?: string): Response => {
    const to = new URL(returnTo, req.url);
    if (error) to.searchParams.set("error", error);
    return new Response(null, {
      status: 303,
      headers: {
        location: to.toString(),
        "set-cookie": cookieHeader(cookie, "", 0, secure()),
      },
    });
  };

  const withUser = async (
    req: Request,
    run: (user: TConnectedUser) => Promise<Response>,
  ): Promise<Response> => {
    const key = await params.userKey(req);
    if (key === null) return notSignedIn();
    try {
      const user = await connect.user(key);
      if (user === null)
        return errorResponse(
          new OpenLLMError(401, "not_connected", "Connect with OpenLLM first"),
        );
      return await run(user);
    } catch (err) {
      return errorResponse(err);
    }
  };

  return {
    start: async (req) => {
      if ((await params.userKey(req)) === null) return notSignedIn();
      const { url, state, codeVerifier } = await connect.start();
      return new Response(null, {
        status: 303,
        headers: {
          location: url,
          "set-cookie": cookieHeader(
            cookie,
            JSON.stringify({ state, codeVerifier }),
            COOKIE_MAX_AGE_S,
            secure(),
          ),
        },
      });
    },

    callback: async (req) => {
      const url = new URL(req.url);
      const denied = url.searchParams.get("error");
      if (denied) return back(req, denied);
      const key = await params.userKey(req);
      const pending = parsePending(readCookie(req, cookie));
      const code = url.searchParams.get("code");
      if (key === null) return back(req, "not_connected");
      if (pending === null || code === null) return back(req, "state_mismatch");
      try {
        await connect.finish({
          userKey: key,
          code,
          pending,
          state: url.searchParams.get("state"),
        });
        return back(req);
      } catch (err) {
        return back(req, isOpenLLMError(err) ? err.code : "openllm_error");
      }
    },

    disconnect: (req) =>
      withUser(req, async (user) => {
        await user.disconnect();
        return Response.json({ ok: true });
      }),

    chat: (req) =>
      withUser(req, async (user) => {
        const body = (await req.json().catch(() => null)) as TChatParams | null;
        if (
          body === null ||
          typeof body.model !== "string" ||
          !Array.isArray(body.messages)
        )
          return errorResponse(
            new OpenLLMError(400, "openllm_error", "Send { model, messages }"),
          );
        const text = await user.chat.stream(body, { signal: req.signal });
        return new Response(encodeTextStream(text), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }),

    status: async (req) => {
      const key = await params.userKey(req);
      if (key === null) return notSignedIn();
      try {
        // Inside the try: a storage failure or bad secret gets the sanitized,
        // logged error answer like every other route.
        const user = await connect.user(key);
        if (user === null) return Response.json({ connected: false });
        const models = await user.models();
        return Response.json({
          connected: true,
          userId: user.userId,
          models: models.map((m) => m.id),
        });
      } catch (err) {
        if (isOpenLLMError(err) && err.needsReconnect)
          return Response.json({ connected: false });
        return errorResponse(err);
      }
    },
  };
};
