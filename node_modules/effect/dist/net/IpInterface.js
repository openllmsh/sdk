/**
 * IPv4 and IPv6 interface addresses that preserve host bits alongside a prefix length.
 *
 * @stability unstable
 * @since 4.0.0
 */
import * as Equal from "../Equal.js";
import * as Hash from "../Hash.js";
import * as Inspectable from "../Inspectable.js";
import { hasProperty } from "../Predicate.js";
import * as Result from "../Result.js";
import * as NetAddress from "./NetAddress.js";
const TypeId = "~effect/net/IpInterface";
/**
 * Returns `true` when a value is an IPv4 interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export const isIpv4Interface = u => isIpInterface(u) && NetAddress.isIpv4Address(u.address);
/**
 * Returns `true` when a value is an IPv6 interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export const isIpv6Interface = u => isIpInterface(u) && NetAddress.isIpv6Address(u.address);
/**
 * Returns `true` when a value is an IP interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export const isIpInterface = u => hasProperty(u, TypeId);
const IpInterfaceProto = {
  ...Inspectable.BaseProto,
  _tag: "IpInterface",
  [TypeId]: TypeId,
  [Equal.symbol](that) {
    return isIpInterface(that) && this.prefixLength === that.prefixLength && Equal.equals(this.address, that.address);
  },
  [Hash.symbol]() {
    return Hash.combine(Hash.hash(this.address), Hash.number(this.prefixLength));
  },
  toString() {
    return format(this);
  },
  toJSON() {
    return this.toString();
  }
};
const interfaceError = (input, message) => Result.fail(new NetAddress.NetAddressError({
  input,
  message
}));
/**
 * Creates an interface address while preserving all address bits.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const make = (address, prefixLength) => {
  const max = NetAddress.width(address);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > max) {
    return interfaceError(address, `prefix length must be an integer from 0 through ${max}`);
  }
  const self = Object.assign(Object.create(IpInterfaceProto), {
    address,
    prefixLength
  });
  return Result.succeed(Object.freeze(self));
};
const parseAddressWithPrefix = (input, options) => {
  const slash = input.indexOf("/");
  if (slash === -1 && options?.prefix !== "required") {
    return Result.succeed({
      address: input,
      prefixLength: undefined
    });
  }
  if (slash <= 0 || slash !== input.lastIndexOf("/") || slash === input.length - 1) {
    return interfaceError(input, "expected an address and prefix length separated by one slash");
  }
  const prefix = input.slice(slash + 1);
  if (!/^(0|[1-9][0-9]*)$/.test(prefix)) {
    return interfaceError(input, "prefix length must be an unpadded ASCII decimal integer");
  }
  return Result.succeed({
    address: input.slice(0, slash),
    prefixLength: Number(prefix)
  });
};
/**
 * Parses an IPv4 interface address while preserving host bits.
 *
 * **Details**
 *
 * A missing prefix defaults to 32. Use `prefix: "required"` to require one.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export const ipv4FromString = (input, options) => Result.flatMap(parseAddressWithPrefix(input, options), parts => Result.flatMap(NetAddress.ipv4FromString(parts.address), address => make(address, parts.prefixLength ?? NetAddress.width(address))));
/**
 * Parses an IPv6 interface address while preserving host bits.
 *
 * **Details**
 *
 * A missing prefix defaults to 128. Use `prefix: "required"` to require one.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export const ipv6FromString = (input, options) => Result.flatMap(parseAddressWithPrefix(input, options), parts => Result.flatMap(NetAddress.ipv6FromString(parts.address), address => make(address, parts.prefixLength ?? NetAddress.width(address))));
/**
 * Parses an IP interface address while preserving host bits.
 *
 * **Details**
 *
 * A missing prefix defaults to the address width. Use `prefix: "required"` to
 * require one.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export const fromString = (input, options) => Result.flatMap(parseAddressWithPrefix(input, options), parts => Result.flatMap(NetAddress.ipFromString(parts.address), address => make(address, parts.prefixLength ?? NetAddress.width(address))));
const fromParts = (input, toAddress) => hasProperty(input, "address") && hasProperty(input, "prefixLength") ? Result.flatMap(toAddress(input.address), address => make(address, input.prefixLength)) : interfaceError(input, "expected an address and prefix length");
/**
 * Converts an `Ipv4InterfaceInput` to an IPv4 interface address, parsing
 * strings like `ipv4FromString` with the given options, converting parts like
 * `make`, and returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const ipv4FromInput = (input, options) => {
  if (isIpv4Interface(input)) return Result.succeed(input);
  if (typeof input === "string") return ipv4FromString(input, options);
  return fromParts(input, NetAddress.ipv4FromInput);
};
/**
 * Converts an `Ipv6InterfaceInput` to an IPv6 interface address, parsing
 * strings like `ipv6FromString` with the given options, converting parts like
 * `make`, and returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const ipv6FromInput = (input, options) => {
  if (isIpv6Interface(input)) return Result.succeed(input);
  if (typeof input === "string") return ipv6FromString(input, options);
  return fromParts(input, NetAddress.ipv6FromInput);
};
/**
 * Converts an `IpInterfaceInput` to an interface address, parsing strings like
 * `fromString` with the given options, converting parts like `make`, and
 * returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const fromInput = (input, options) => {
  if (isIpInterface(input)) return Result.succeed(input);
  if (typeof input === "string") return fromString(input, options);
  return fromParts(input, NetAddress.ipFromInput);
};
/**
 * Converts a trusted `IpInterfaceInput` to an interface address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export const fromInputUnsafe = (input, options) => Result.getOrThrow(fromInput(input, options));
/**
 * Creates a trusted interface address, throwing when its prefix length is invalid.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export const makeUnsafe = (address, prefixLength) => Result.getOrThrow(make(address, prefixLength));
/**
 * Parses a trusted interface address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export const fromStringUnsafe = (input, options) => Result.getOrThrow(fromString(input, options));
/**
 * Formats an interface address using canonical address text and its decimal prefix length.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export const format = self => `${NetAddress.formatIp(self.address)}/${self.prefixLength}`;
//# sourceMappingURL=IpInterface.js.map