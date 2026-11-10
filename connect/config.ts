/** What your app needs, from the .env block OpenLLM showed you once. */
export type TConnectConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Your app's X25519 private key: base64 PKCS#8 (`OPENLLM_PRIVATE_KEY`). */
  readonly privateKey: string;
  /** The OAuth issuer; authorize, token and revoke live under it. */
  readonly issuer: string;
  /** Always sent as `resource`, or the access token comes back opaque. */
  readonly resource: string;
  /** OpenLLM's origin: key pickup and the `/v1` API live here. */
  readonly apiOrigin: string;
  /** Exactly one of the callback URLs you registered. */
  readonly redirectUri: string;
};

export const DEFAULT_CONNECT_RESOURCE = "https://openllm.sh/v1";

type TEnv = Readonly<Record<string, string | undefined>>;

const processEnv = (): TEnv =>
  (globalThis as { process?: { env: TEnv } }).process?.env ?? {};

/** Read the config from the `OPENLLM_*` variables in the .env block. */
export const connectConfigFromEnv = (
  env: TEnv = processEnv(),
): TConnectConfig => {
  const need = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    clientId: need("OPENLLM_CLIENT_ID"),
    clientSecret: need("OPENLLM_CLIENT_SECRET"),
    privateKey: need("OPENLLM_PRIVATE_KEY"),
    issuer: need("OPENLLM_ISSUER").replace(/\/+$/, ""),
    resource: env.OPENLLM_RESOURCE?.trim() || DEFAULT_CONNECT_RESOURCE,
    apiOrigin: need("OPENLLM_API_ORIGIN").replace(/\/+$/, ""),
    redirectUri: need("OPENLLM_REDIRECT_URI"),
  };
};

/** The "Connect with OpenLLM" button image, served by OpenLLM. */
export const connectButtonUrl = (
  config: Pick<TConnectConfig, "apiOrigin">,
): string => `${config.apiOrigin}/connect/button.svg`;
