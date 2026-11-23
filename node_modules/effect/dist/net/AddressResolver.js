/**
 * Resolves host and port endpoints to socket addresses.
 *
 * The `AddressResolver` service turns a `Host.HostPort` or `host:port` string
 * into socket addresses. Numeric hosts are converted without a lookup. IPv6
 * literals with a named zone such as `fe80::1%eth0` get their scope ID from the host's
 * network interfaces, and domain names are looked up with the `Dns` service.
 * Runtime layers look up network interfaces; this module's layer requires
 * only `Dns` and supports numeric zones only.
 *
 * @stability experimental
 * @since 4.0.0
 */
import * as Arr from "../Array.js";
import * as Context from "../Context.js";
import * as Effect from "../Effect.js";
import * as Layer from "../Layer.js";
import * as Option from "../Option.js";
import * as Dns from "./Dns.js";
import * as Host from "./Host.js";
import * as NetAddress from "./NetAddress.js";
/**
 * Service that resolves endpoints to internet and socket addresses.
 *
 * **Details**
 *
 * Every operation either returns at least one address or fails. Lookups fail
 * with a `Dns.DnsError`, and hosts that cannot be converted, such as IPv6
 * literals with an unknown zone or numeric addresses outside the requested
 * family, fail with a `NetAddress.NetAddressError`.
 *
 * @stability experimental
 * @category services
 * @since 4.0.0
 */
export class AddressResolver extends /*#__PURE__*/Context.Service()("effect/net/AddressResolver") {}
const inFamily = (address, family) => family === undefined || NetAddress.isFamily(address, family) ? Effect.succeed(Arr.of(address)) : Effect.fail(new NetAddress.NetAddressError({
  input: address,
  message: `expected an ${family} address`
}));
/**
 * Creates an `AddressResolver` that looks up domain names with a `Dns`
 * service.
 *
 * **Example** (Resolving an endpoint with a static resolver)
 *
 * ```ts import.meta.vitest
 * import { Effect, Result } from "effect"
 * import { AddressResolver, Dns, NetAddress } from "effect/net"
 *
 * const dns = Result.getOrThrow(Dns.makeStatic({
 *   hosts: { "db.internal": ["10.0.0.5"] }
 * }))
 * const resolver = AddressResolver.make(dns)
 *
 * const program = resolver.resolve("db.internal:5432").pipe(
 *   Effect.map((addresses) => addresses.map(NetAddress.formatInet))
 * )
 *
 * await Effect.runPromise(program) // => ["10.0.0.5:5432"]
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const make = (dns, options) => {
  const scopeId = options?.scopeId;
  const fromLiteral = (host, port) => {
    if (NetAddress.isIpAddress(host)) return Effect.fromResult(NetAddress.inetAddress(host, port));
    const zone = host.slice(host.indexOf("%") + 1);
    if (scopeId === undefined || /^\d+$/.test(zone)) {
      return Effect.fromResult(NetAddress.inetAddressFromHostString(host, port));
    }
    return Effect.flatMap(scopeId(zone), id => Effect.fromResult(NetAddress.inetAddressFromHostString(host, port, Option.isSome(id) ? new Map([[zone, id.value]]) : undefined)));
  };
  const resolve = (target, options) => {
    const family = options?.family;
    if (NetAddress.isUnixPathAddress(target)) return Effect.succeed(Arr.of(target));
    if (NetAddress.isInetAddress(target)) return inFamily(target, family);
    if (!Host.isHostPort(target)) {
      return Effect.flatMap(Effect.fromResult(Host.hostPortFromInput(target)), endpoint => resolve(endpoint, options));
    }
    const {
      host,
      port
    } = target;
    if (NetAddress.isIpAddress(host) || NetAddress.isScopedIpv6Literal(host)) {
      return Effect.flatMap(fromLiteral(host, port), address => inFamily(address, family));
    }
    return Effect.flatMap(dns.lookup(host, {
      family
    }), addresses => {
      // Lookups do not report the scope that a link-local IPv6 address needs.
      const usable = addresses.filter(address => !(NetAddress.isIpv6Address(address) && NetAddress.isLinkLocal(address)));
      return Arr.isReadonlyArrayNonEmpty(usable) ? Effect.succeed(Arr.map(usable, address => NetAddress.inetAddressUnsafe(address, port))) : Effect.fail(new NetAddress.NetAddressError({
        input: host,
        message: "only link-local IPv6 addresses were found, and lookups do not report their scope"
      }));
    });
  };
  return AddressResolver.of({
    resolve: resolve
  });
};
/**
 * Creates a layer that provides an `AddressResolver` using the `Dns` service.
 *
 * @stability experimental
 * @category layers
 * @since 4.0.0
 */
export const layer = options => Layer.effect(AddressResolver, Effect.map(Effect.service(Dns.Dns), dns => make(dns, options)));
//# sourceMappingURL=AddressResolver.js.map