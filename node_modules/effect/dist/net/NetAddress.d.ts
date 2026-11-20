/**
 * Pure, platform-neutral values for MAC, IP, internet socket, and Unix path addresses.
 *
 * @stability unstable
 * @since 4.0.0
 */
import type * as Brand from "../Brand.ts";
import * as Equal from "../Equal.ts";
import * as Hash from "../Hash.ts";
import * as Inspectable from "../Inspectable.ts";
import * as Option from "../Option.ts";
import * as Result from "../Result.ts";
import type { TupleOf } from "../Types.ts";
declare const TypeId: "~effect/net/NetAddress";
/**
 * An immutable 32-bit IPv4 address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface Ipv4Address extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "Ipv4Address";
    readonly [TypeId]: typeof TypeId;
}
/**
 * An immutable 128-bit IPv6 address without socket scope metadata.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface Ipv6Address extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "Ipv6Address";
    readonly [TypeId]: typeof TypeId;
}
/**
 * A numeric IPv4 or IPv6 address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type IpAddress = Ipv4Address | Ipv6Address;
/**
 * The four octets of an IPv4 address in network order.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv4Octets = Readonly<TupleOf<4, number>>;
/**
 * The eight 16-bit segments of an IPv6 address in network order.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv6Segments = Readonly<TupleOf<8, number>>;
/**
 * The six octets of a MAC address in transmission order.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type MacAddressOctets = Readonly<TupleOf<6, number>>;
/**
 * An IPv4 address, or a string, four octets, or four network-order bytes to
 * convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv4AddressInput = Ipv4Address | string | Ipv4Octets | Uint8Array;
/**
 * An IPv6 address, or a string, eight 16-bit segments, or sixteen
 * network-order bytes to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv6AddressInput = Ipv6Address | string | Ipv6Segments | Uint8Array;
/**
 * An IP address, or any `Ipv4AddressInput` or `Ipv6AddressInput` to convert to
 * one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type IpAddressInput = Ipv4AddressInput | Ipv6AddressInput;
/**
 * An IPv6 literal with a zone, such as `fe80::1%eth0` or `fe80::1%3`.
 *
 * **Details**
 *
 * Named zones are kept as written because mapping an interface name to a
 * numeric scope ID requires the operating system's interface table. Numeric
 * zones must be unsigned 32-bit integers and are stored without leading zeros,
 * and the address part is stored in canonical form.
 *
 * @see {@link scopedIpv6LiteralFromString} for parsing scoped IPv6 literals
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type ScopedIpv6Literal = Brand.Branded<string, "~effect/net/NetAddress/ScopedIpv6Literal">;
/**
 * A scoped IPv6 literal or a string to parse as one.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type ScopedIpv6LiteralInput = ScopedIpv6Literal | string;
/**
 * An immutable 48-bit IEEE 802 MAC address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface MacAddress extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "MacAddress";
    readonly [TypeId]: typeof TypeId;
}
/**
 * A MAC address, or a string or six octets to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type MacAddressInput = MacAddress | string | MacAddressOctets;
declare const MulticastTypeId: "~effect/net/NetAddress/MulticastAddress";
declare const UnicastTypeId: "~effect/net/NetAddress/UnicastAddress";
declare const BroadcastTypeId: "~effect/net/NetAddress/BroadcastAddress";
declare const LoopbackTypeId: "~effect/net/NetAddress/LoopbackAddress";
declare const LinkLocalTypeId: "~effect/net/NetAddress/LinkLocalAddress";
declare const UnspecifiedTypeId: "~effect/net/NetAddress/UnspecifiedAddress";
declare const PrivateTypeId: "~effect/net/NetAddress/PrivateAddress";
declare const UniqueLocalTypeId: "~effect/net/NetAddress/UniqueLocalAddress";
declare const LocallyAdministeredTypeId: "~effect/net/NetAddress/LocallyAdministeredAddress";
declare const UniversallyAdministeredTypeId: "~effect/net/NetAddress/UniversallyAdministeredAddress";
/**
 * An IP or MAC address proven to be multicast (IPv4 `224.0.0.0/4`, IPv6
 * `ff00::/8`, or a MAC address with the IEEE group bit set).
 *
 * **Details**
 *
 * This is a branded refinement of the underlying address. Construction returns
 * the same runtime value, preserving identity, equality, hashing, and formatting.
 * The MAC all-ones broadcast address has the group bit set and is therefore
 * multicast; use {@link isMacBroadcast} to distinguish it. The IPv4 limited
 * broadcast address `255.255.255.255` is not multicast.
 *
 * The default type argument remains `IpAddress`; specify `MacAddress` or an
 * explicit IP/MAC union when accepting those wider address families.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type MulticastAddress<A extends IpAddress | MacAddress = IpAddress> = Brand.Branded<A, typeof MulticastTypeId>;
/**
 * An IP or MAC address proven to be syntactically unicast.
 *
 * **Details**
 *
 * For IP addresses this excludes multicast, unspecified, and the IPv4 limited
 * broadcast address. Reserved and special-purpose addresses may still satisfy
 * this refinement, as may an IPv4 directed broadcast whose network prefix is
 * unknown. It does not promise reachability or destination usability. For MAC
 * addresses it means that the IEEE individual/group bit is clear.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type UnicastAddress<A extends IpAddress | MacAddress = IpAddress | MacAddress> = Brand.Branded<A, typeof UnicastTypeId>;
/**
 * An IPv4 limited-broadcast or MAC all-ones broadcast address.
 *
 * **Details**
 *
 * MAC broadcast is also multicast because its IEEE group bit is set. IPv4
 * limited broadcast is not multicast. Directed IPv4 broadcast requires network
 * prefix context and is intentionally not represented by this refinement.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type BroadcastAddress<A extends Ipv4Address | MacAddress = Ipv4Address | MacAddress> = A extends MacAddress ? Brand.Branded<MulticastAddress<A>, typeof BroadcastTypeId> : Brand.Branded<A, typeof BroadcastTypeId>;
/**
 * An IP address proven to be loopback.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type LoopbackAddress<A extends IpAddress = IpAddress> = Brand.Branded<A, typeof LoopbackTypeId>;
/**
 * An IP address proven to be link-local.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type LinkLocalAddress<A extends IpAddress = IpAddress> = Brand.Branded<A, typeof LinkLocalTypeId>;
/**
 * An all-zero IPv4 or IPv6 address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type UnspecifiedAddress<A extends IpAddress = IpAddress> = Brand.Branded<A, typeof UnspecifiedTypeId>;
/**
 * An IPv4 private-use address in an RFC 1918 range.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type PrivateAddress<A extends Ipv4Address = Ipv4Address> = Brand.Branded<A, typeof PrivateTypeId>;
/**
 * An IPv6 unique-local address in `fc00::/7`.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type UniqueLocalAddress<A extends Ipv6Address = Ipv6Address> = Brand.Branded<A, typeof UniqueLocalTypeId>;
/**
 * A MAC address whose IEEE universal/local bit marks it as locally administered.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type LocallyAdministeredAddress<A extends MacAddress = MacAddress> = Brand.Branded<A, typeof LocallyAdministeredTypeId>;
/**
 * A MAC address whose IEEE universal/local bit marks it as universally administered.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type UniversallyAdministeredAddress<A extends MacAddress = MacAddress> = Brand.Branded<A, typeof UniversallyAdministeredTypeId>;
/**
 * A resolved IPv4 internet address and port.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface InetAddressV4 extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "InetAddressV4";
    readonly address: Ipv4Address;
    readonly port: number;
    readonly [TypeId]: typeof TypeId;
}
/**
 * A resolved IPv6 internet address, port, and scope identifier.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface InetAddressV6 extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "InetAddressV6";
    readonly address: Ipv6Address;
    readonly port: number;
    readonly scopeId: number;
    readonly [TypeId]: typeof TypeId;
}
/**
 * A resolved IPv4 or IPv6 internet address and port.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type InetAddress = InetAddressV4 | InetAddressV6;
/**
 * The address, port, and optional IPv6 scope identifier of an internet address.
 *
 * **Details**
 *
 * A nonzero `scopeId` is only valid with an IPv6 address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface InetAddressParts<A extends IpAddressInput = IpAddressInput> {
    readonly address: A;
    readonly port: number;
    readonly scopeId?: number | undefined;
}
/**
 * An internet address and port, or a string or parts to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type InetAddressInput = InetAddress | string | InetAddressParts;
/**
 * An opaque Unix-domain filesystem socket path.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface UnixPathAddress extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "UnixPathAddress";
    readonly path: string;
    readonly [TypeId]: typeof TypeId;
}
/**
 * A portable concrete internet or Unix-domain filesystem address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type SocketAddress = InetAddress | UnixPathAddress;
/**
 * The path of a Unix-domain socket address.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface UnixPathAddressParts {
    readonly path: string;
}
/**
 * Companion types for constructing socket addresses.
 *
 * @stability unstable
 * @since 4.0.0
 */
export declare namespace SocketAddress {
    /**
     * Input that can be converted to a concrete `SocketAddress` without hostname
     * resolution.
     *
     * **Details**
     *
     * Accepts any `InetAddressInput` or a Unix path. String inputs must use
     * `IPv4:port` or `[IPv6]:port` notation.
     *
     * @stability unstable
     * @category models
     * @since 4.0.0
     */
    type Input = SocketAddress | InetAddressInput | UnixPathAddressParts;
}
/**
 * The IPv4 or IPv6 family of an IP address or internet address type.
 *
 * **Details**
 *
 * Refinements such as `MulticastAddress<A>` are dropped; the result is the
 * plain `Ipv4Address` or `Ipv6Address` for the family. Unions distribute, so
 * `Family<IpAddress>` and `Family<InetAddress>` are both `IpAddress`.
 *
 * **Example** (Deriving the family of an internet address)
 *
 * ```ts import.meta.vitest
 * import { NetAddress } from "effect/net"
 *
 * const family: NetAddress.Family<NetAddress.InetAddressV6> = NetAddress.ipv6Loopback
 * ```
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Family<A extends IpAddress | InetAddress> = A extends Ipv4Address | InetAddressV4 ? Ipv4Address : Ipv6Address;
/**
 * The name of an IP address family, spelled as in `os.networkInterfaces()` and
 * socket address information on Node.js, Deno, and Bun.
 *
 * @see {@link familyOf} for reading the family of an address
 * @see {@link FamilyAddress} for the address type of a family
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type IpFamily = "IPv4" | "IPv6";
/**
 * The IP address type for an IP address family name. `FamilyAddress<IpFamily>`
 * is `IpAddress`.
 *
 * @see {@link Family} for the inverse mapping from an address type
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type FamilyAddress<F extends IpFamily> = F extends "IPv4" ? Ipv4Address : Ipv6Address;
/**
 * The internet address type for an IP address family.
 *
 * **Details**
 *
 * `Inet<Ipv4Address>` is `InetAddressV4` and `Inet<Ipv6Address>` is
 * `InetAddressV6`. Refinements on `A` are dropped because the port-carrying
 * types hold a plain family address. `Inet<IpAddress>` is `InetAddress`.
 *
 * **Example** (Selecting the internet address for a family)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { NetAddress } from "effect/net"
 *
 * const endpoint: NetAddress.Inet<NetAddress.Ipv4Address> = Result.getOrThrow(
 *   NetAddress.inetAddressV4(NetAddress.ipv4Loopback, 8080)
 * )
 * ```
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Inet<A extends IpAddress = IpAddress> = A extends Ipv4Address ? InetAddressV4 : InetAddressV6;
/**
 * A native multicast interface selector for an IP address family: an interface
 * address for IPv4 or an interface index for IPv6. `ipv4Unspecified` and index
 * `0` select the operating system default.
 *
 * **Example** (Selecting multicast interfaces by family)
 *
 * ```ts import.meta.vitest
 * import { NetAddress } from "effect/net"
 *
 * const ipv4Interface: NetAddress.MulticastInterface<NetAddress.Ipv4Address> =
 *   NetAddress.ipv4Unspecified
 * const ipv6Interface: NetAddress.MulticastInterface<NetAddress.Ipv6Address> = 0
 * ```
 *
 * @see {@link formatMulticastInterface}
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type MulticastInterface<A extends IpAddress = IpAddress> = A extends Ipv4Address ? Ipv4Address : number;
declare const NetAddressError_base: new <A extends Record<string, any> = {}>(args: import("../Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("../Cause.ts").YieldableError & {
    readonly _tag: "NetAddressError";
} & Readonly<A>;
/**
 * A checked network-address operation failure retaining the address or supplied input.
 *
 * **Details**
 *
 * Address-based operations retain the address value. Parsing and numeric
 * construction retain the supplied string or array. Composed operations forward
 * errors from the failing operation unchanged. Failures from external operations
 * retain the original exception in `cause` when available.
 *
 * @stability unstable
 * @category errors
 * @since 4.0.0
 */
export declare class NetAddressError extends NetAddressError_base<{
    readonly message: string;
    readonly input: unknown;
    readonly cause?: unknown;
}> {
}
/**
 * Returns `true` when a value is an IPv4 address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpv4Address: (u: unknown) => u is Ipv4Address;
/**
 * Returns `true` when a value is an IPv6 address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpv6Address: (u: unknown) => u is Ipv6Address;
/**
 * Returns `true` when a value is an IPv4 or IPv6 address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpAddress: (u: unknown) => u is IpAddress;
/**
 * Returns the bit width of an IP address.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.0
 */
export declare const width: (address: IpAddress) => 32 | 128;
/**
 * Returns the family of an IP address or internet address.
 *
 * **Example** (Reading address families)
 *
 * ```ts import.meta.vitest
 * import { NetAddress } from "effect/net"
 *
 * NetAddress.familyOf(NetAddress.ipv4Loopback) // => "IPv4"
 * NetAddress.familyOf(NetAddress.inetAddressFromStringUnsafe("[::1]:80")) // => "IPv6"
 * ```
 *
 * @stability experimental
 * @category getters
 * @since 4.0.0
 */
export declare const familyOf: (self: IpAddress | InetAddress) => IpFamily;
/**
 * Returns `true` when an IP address or internet address belongs to a family,
 * narrowing it to that family.
 *
 * @stability experimental
 * @category predicates
 * @since 4.0.0
 */
export declare const isFamily: {
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    (family: "IPv4"): <A extends IpAddress | InetAddress>(self: A) => self is Extract<A, Ipv4Address | InetAddressV4>;
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    (family: "IPv6"): <A extends IpAddress | InetAddress>(self: A) => self is Extract<A, Ipv6Address | InetAddressV6>;
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    (family: IpFamily): (self: IpAddress | InetAddress) => boolean;
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    <A extends IpAddress | InetAddress>(self: A, family: "IPv4"): self is Extract<A, Ipv4Address | InetAddressV4>;
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    <A extends IpAddress | InetAddress>(self: A, family: "IPv6"): self is Extract<A, Ipv6Address | InetAddressV6>;
    /**
     * Returns `true` when an IP address or internet address belongs to a family,
     * narrowing it to that family.
     *
     * @stability experimental
     * @category predicates
     * @since 4.0.0
     */
    (self: IpAddress | InetAddress, family: IpFamily): boolean;
};
/**
 * Returns `true` when a value is a MAC address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isMacAddress: (u: unknown) => u is MacAddress;
/**
 * Returns `true` when a value is a resolved IPv4 internet address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isInetAddressV4: (u: unknown) => u is InetAddressV4;
/**
 * Returns `true` when a value is a resolved IPv6 internet address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isInetAddressV6: (u: unknown) => u is InetAddressV6;
/**
 * Returns `true` when a value is a resolved internet address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isInetAddress: (u: unknown) => u is InetAddress;
/**
 * Returns `true` when a value is a Unix-domain filesystem address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isUnixPathAddress: (u: unknown) => u is UnixPathAddress;
/**
 * Returns `true` when a value is a portable concrete socket address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isSocketAddress: (u: unknown) => u is SocketAddress;
/**
 * Creates an IPv4 address from trusted network-order bytes without validation.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const ipv4FromBytesUnsafe: (bytes: Uint8Array) => Ipv4Address;
/**
 * Creates an IPv6 address from trusted network-order bytes without validation.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const ipv6FromBytesUnsafe: (bytes: Uint8Array) => Ipv6Address;
/**
 * The IPv4 loopback address `127.0.0.1`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const ipv4Loopback: Ipv4Address;
/**
 * The IPv6 loopback address `::1`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const ipv6Loopback: Ipv6Address;
/**
 * The loopback addresses `127.0.0.1` and `::1`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const loopbackAddresses: readonly [Ipv4Address, Ipv6Address];
/**
 * The unspecified IPv4 address `0.0.0.0`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const ipv4Unspecified: Ipv4Address;
/**
 * The unspecified IPv6 address `::`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const ipv6Unspecified: Ipv6Address;
/**
 * The IPv4 broadcast address `255.255.255.255`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.0
 */
export declare const ipv4Broadcast: Ipv4Address;
/**
 * Creates an IPv4 address from four checked octets.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv4FromOctets: (octets: Ipv4Octets) => Result.Result<Ipv4Address, NetAddressError>;
/**
 * Creates an IPv6 address from eight checked 16-bit segments.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv6FromSegments: (segments: Ipv6Segments) => Result.Result<Ipv6Address, NetAddressError>;
/**
 * Creates a MAC address from six checked octets.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const macAddressFromOctets: (octets: MacAddressOctets) => Result.Result<MacAddress, NetAddressError>;
/**
 * Parses a colon-separated MAC address containing six two-digit hexadecimal octets.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const macAddressFromString: (input: string) => Result.Result<MacAddress, NetAddressError>;
/**
 * Parses a trusted colon-separated MAC address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const macAddressFromStringUnsafe: (input: string) => MacAddress;
/**
 * Converts a `MacAddressInput` to a MAC address, parsing strings like
 * `macAddressFromString`, checking octets like `macAddressFromOctets`, and
 * returning MAC addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const macAddressFromInput: (input: MacAddressInput) => Result.Result<MacAddress, NetAddressError>;
/**
 * Converts a trusted `MacAddressInput` to a MAC address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const macAddressFromInputUnsafe: (input: MacAddressInput) => MacAddress;
/**
 * Parses a strict dotted-decimal IPv4 address.
 *
 * **Details**
 *
 * Multi-digit octets with a leading zero are rejected to avoid octal ambiguity.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const ipv4FromString: (input: string) => Result.Result<Ipv4Address, NetAddressError>;
/**
 * Parses an IPv6 address with optional compression and trailing embedded IPv4.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const ipv6FromString: (input: string) => Result.Result<Ipv6Address, NetAddressError>;
/**
 * Parses a bare numeric IPv4 or IPv6 address.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const ipFromString: (input: string) => Result.Result<IpAddress, NetAddressError>;
/**
 * Parses a trusted bare numeric IPv4 or IPv6 address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const ipFromStringUnsafe: (input: string) => IpAddress;
/**
 * Converts an `IpAddressInput` to an IP address, returning IP addresses
 * unchanged.
 *
 * **Details**
 *
 * Strings are parsed like `ipFromString`. Four octets or bytes make an IPv4
 * address, and eight segments or sixteen bytes make an IPv6 address.
 *
 * **Example** (Converting IP address inputs)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { NetAddress } from "effect/net"
 *
 * const address = Result.getOrThrow(NetAddress.ipFromInput("192.0.2.1"))
 * NetAddress.formatIp(address) // => "192.0.2.1"
 * Result.getOrThrow(NetAddress.ipFromInput(address)) === address // => true
 * NetAddress.formatIp(Result.getOrThrow(NetAddress.ipFromInput([192, 0, 2, 1]))) // => "192.0.2.1"
 * Result.isFailure(NetAddress.ipFromInput("example.com")) // => true
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipFromInput: (input: IpAddressInput) => Result.Result<IpAddress, NetAddressError>;
/**
 * Converts a trusted `IpAddressInput` to an IP address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const ipFromInputUnsafe: (input: IpAddressInput) => IpAddress;
/**
 * Converts an `Ipv4AddressInput` to an IPv4 address, parsing strings like
 * `ipv4FromString`, checking octets like `ipv4FromOctets`, and returning IPv4
 * addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv4FromInput: (input: Ipv4AddressInput) => Result.Result<Ipv4Address, NetAddressError>;
/**
 * Converts an `Ipv6AddressInput` to an IPv6 address, parsing strings like
 * `ipv6FromString`, checking segments like `ipv6FromSegments`, and returning
 * IPv6 addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv6FromInput: (input: Ipv6AddressInput) => Result.Result<Ipv6Address, NetAddressError>;
/**
 * Returns `true` when a value is a canonical scoped IPv6 literal.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isScopedIpv6Literal: (u: unknown) => u is ScopedIpv6Literal;
/**
 * Parses an IPv6 literal with a numeric or named zone, such as `fe80::1%eth0`.
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export declare const scopedIpv6LiteralFromString: (input: string) => Result.Result<ScopedIpv6Literal, NetAddressError>;
/**
 * Converts a `ScopedIpv6LiteralInput` to a scoped IPv6 literal, parsing it
 * like `scopedIpv6LiteralFromString`.
 *
 * **Details**
 *
 * Scoped IPv6 literals are strings, so every input is parsed.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const scopedIpv6LiteralFromInput: (input: ScopedIpv6LiteralInput) => Result.Result<ScopedIpv6Literal, NetAddressError>;
/**
 * Returns the four numeric octets of an IPv4 address in a fresh tuple.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.0
 */
export declare const ipv4ToOctets: (self: Ipv4Address) => Ipv4Octets;
/**
 * Returns the eight numeric segments of an IPv6 address in a fresh tuple.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.0
 */
export declare const ipv6ToSegments: (self: Ipv6Address) => Ipv6Segments;
/**
 * Returns the sixteen numeric octets of an IPv6 address in a fresh array.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.0
 */
export declare const ipv6ToOctets: (self: Ipv6Address) => ReadonlyArray<number>;
/**
 * Returns the six numeric octets of a MAC address in a fresh tuple.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.0
 */
export declare const macAddressToOctets: (self: MacAddress) => MacAddressOctets;
/**
 * Formats a MAC address as six lowercase hexadecimal octets separated by colons.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatMacAddress: (self: MacAddress) => string;
/**
 * Returns `true` when the MAC address is the all-ones broadcast address.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMacBroadcast: <A extends MacAddress>(self: A) => self is BroadcastAddress<A>;
/**
 * Returns `true` when the MAC address has the IEEE group-address bit set.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMacMulticast: <A extends MacAddress>(self: A) => self is MulticastAddress<A>;
/**
 * Returns `true` when the MAC address has the IEEE group-address bit clear.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMacUnicast: <A extends MacAddress>(self: A) => self is UnicastAddress<A>;
/**
 * Returns `true` when the MAC address has the IEEE local-administration bit set.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMacLocallyAdministered: <A extends MacAddress>(self: A) => self is LocallyAdministeredAddress<A>;
/**
 * Returns `true` when the MAC address has the IEEE local-administration bit clear.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMacUniversallyAdministered: <A extends MacAddress>(self: A) => self is UniversallyAdministeredAddress<A>;
/**
 * Folds an IP address by its numeric version.
 *
 * @stability unstable
 * @category pattern matching
 * @since 4.0.0
 */
export declare const match: {
    /**
     * Folds an IP address by its numeric version.
     *
     * @stability unstable
     * @category pattern matching
     * @since 4.0.0
     */
    <A, B>(options: {
        readonly onIpv4: (address: Ipv4Address) => A;
        readonly onIpv6: (address: Ipv6Address) => B;
    }): (self: IpAddress) => A | B;
    /**
     * Folds an IP address by its numeric version.
     *
     * @stability unstable
     * @category pattern matching
     * @since 4.0.0
     */
    <A, B>(self: IpAddress, options: {
        readonly onIpv4: (address: Ipv4Address) => A;
        readonly onIpv6: (address: Ipv6Address) => B;
    }): A | B;
};
/**
 * Formats an IP address in canonical numeric form.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatIp: (self: IpAddress) => string;
/**
 * Returns `true` for the all-zero address of either IP version.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isUnspecified: <A extends IpAddress>(self: A) => self is UnspecifiedAddress<A>;
/**
 * Returns `true` for IPv4 `127.0.0.0/8` or IPv6 `::1`.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isLoopback: <A extends IpAddress>(self: A) => self is LoopbackAddress<A>;
/**
 * Returns `true` for IPv4 `224.0.0.0/4`, IPv6 `ff00::/8`, or a MAC address with
 * the IEEE group bit set, refining the value while preserving its address type.
 *
 * **Details**
 *
 * The MAC all-ones broadcast address has the group bit set and is multicast;
 * the IPv4 limited broadcast address `255.255.255.255` is not. Use
 * {@link isMacBroadcast} or {@link isBroadcast} to distinguish broadcast.
 *
 * **Example** (Classifying IP and MAC group addresses)
 *
 * ```ts import.meta.vitest
 * import { assert } from "@effect/vitest"
 * import { NetAddress } from "effect/net"
 *
 * const ip = NetAddress.ipFromStringUnsafe("239.255.0.1")
 * const mac = NetAddress.macAddressFromStringUnsafe("ff:ff:ff:ff:ff:ff")
 *
 * assert.isTrue(NetAddress.isMulticast(ip))
 * assert.isTrue(NetAddress.isMulticast(mac))
 * assert.isTrue(NetAddress.isBroadcast(mac))
 * assert.isFalse(NetAddress.isMulticast(NetAddress.ipv4Broadcast))
 * ```
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isMulticast: <A extends IpAddress | MacAddress>(self: A) => self is MulticastAddress<A>;
/**
 * Returns `true` for the IPv4 limited broadcast address `255.255.255.255` or
 * the MAC all-ones broadcast address.
 *
 * **Details**
 *
 * MAC broadcast is also multicast because its IEEE group bit is set. IPv4
 * limited broadcast is not multicast. Directed IPv4 broadcast cannot be
 * determined without a network prefix and is not classified here.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isBroadcast: <A extends Ipv4Address | MacAddress>(self: A) => self is BroadcastAddress<A>;
/**
 * Returns `true` when an address is syntactically unicast.
 *
 * **Details**
 *
 * IP addresses exclude multicast, unspecified, and IPv4 limited broadcast.
 * This does not exclude reserved ranges, prefix-relative directed broadcast,
 * or addresses that are unusable or unreachable in a particular deployment.
 * MAC addresses are unicast when their IEEE individual/group bit is clear.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isUnicast: <A extends IpAddress | MacAddress>(self: A) => self is UnicastAddress<A>;
/**
 * Returns `true` for IPv4 `169.254.0.0/16` or IPv6 `fe80::/10`.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isLinkLocal: <A extends IpAddress>(self: A) => self is LinkLocalAddress<A>;
/**
 * Returns `true` for IPv4 private-use ranges defined by RFC 1918.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isPrivate: <A extends Ipv4Address>(self: A) => self is PrivateAddress<A>;
/**
 * Returns `true` for IPv6 unique-local addresses in `fc00::/7`.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isUniqueLocal: <A extends Ipv6Address>(self: A) => self is UniqueLocalAddress<A>;
/**
 * Returns `true` when an IPv6 address is in the `::ffff:0:0/96` mapped range.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.0
 */
export declare const isIpv4Mapped: (self: Ipv6Address) => boolean;
/**
 * Converts an IPv4 address to its IPv4-mapped IPv6 representation.
 *
 * @stability unstable
 * @category converting
 * @since 4.0.0
 */
export declare const toIpv4Mapped: (self: Ipv4Address) => Ipv6Address;
/**
 * Extracts the IPv4 value from an IPv4-mapped IPv6 address.
 *
 * @stability unstable
 * @category converting
 * @since 4.0.0
 */
export declare const fromIpv4Mapped: (self: Ipv6Address) => Option.Option<Ipv4Address>;
/**
 * Converts IPv4-mapped IPv6 addresses to IPv4, including the IP component of internet addresses.
 *
 * **Details**
 *
 * Internet addresses retain their port. Addresses that need no conversion are
 * returned unchanged, preserving their identity and any IPv6 scope identifier.
 * Converted internet addresses are IPv4 values without IPv6 scope metadata.
 *
 * @stability unstable
 * @category converting
 * @since 4.0.0
 */
export declare function toCanonical(self: IpAddress): IpAddress;
/**
 * @stability unstable
 */
export declare function toCanonical(self: InetAddress): InetAddress;
/**
 * Creates a checked IPv4 internet address.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const inetAddressV4: (address: Ipv4Address, port: number) => Result.Result<InetAddressV4, NetAddressError>;
/**
 * Creates a checked IPv6 internet address with an optional scope identifier.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const inetAddressV6: (address: Ipv6Address, port: number, options?: {
    readonly scopeId?: number | undefined;
}) => Result.Result<InetAddressV6, NetAddressError>;
/**
 * Creates a checked internet address for an IP address and port.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const inetAddress: (address: IpAddress, port: number) => Result.Result<InetAddress, NetAddressError>;
/**
 * Creates an internet address from a trusted IP address and port, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const inetAddressUnsafe: (address: IpAddress, port: number) => InetAddress;
/**
 * Creates a checked internet address from a numeric IP string and port.
 *
 * **Gotchas**
 *
 * The address must be a numeric IPv4 or IPv6 literal. This function does not
 * resolve hostnames or accept IPv6 brackets.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const inetAddressFromIpString: (address: string, port: number) => Result.Result<InetAddress, NetAddressError>;
/**
 * Creates an internet address from a trusted numeric IP string and port.
 *
 * **Gotchas**
 *
 * This function throws when either input is invalid. Use only when both values
 * are already known to satisfy the checked constructor's requirements.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const inetAddressFromIpStringUnsafe: (address: string, port: number) => InetAddress;
/**
 * Creates an internet address from a trusted native numeric host and port.
 * Named IPv6 zones are resolved using the supplied interface-to-scope map.
 * Use only for runtime-supplied socket addresses: this skips input validation,
 * so malformed strings or ports may silently produce incorrect values. An
 * unknown named IPv6 zone throws rather than losing its scope.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const inetAddressFromNativeUnsafe: (host: string, port: number, scopeIds?: ReadonlyMap<string, number>) => InetAddress;
/**
 * Parses an unbracketed numeric host and port, resolving named IPv6 zones using
 * a supplied map of interface names to numeric scope IDs.
 *
 * **Details**
 *
 * IPv4, unscoped IPv6, and numeric IPv6 zones need no map. Named zones must have
 * a matching map entry. This function performs no DNS or operating-system lookup.
 *
 * @see {@link formatHost} for formatting the host of an internet address
 * @see {@link scopeIdsFromInterfaces} for building a scope map from interface entries
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const inetAddressFromHostString: (host: string, port: number, scopeIds?: ReadonlyMap<string, number>) => Result.Result<InetAddress, NetAddressError>;
/**
 * Network interface address metadata used to resolve IPv6 scope IDs.
 *
 * @see {@link scopeIdsFromInterfaces}
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface NetworkInterfaceAddress {
    readonly family: string;
    readonly scopeid?: number | null | undefined;
}
/**
 * Returns the IPv6 scope ID of a network interface from its addresses.
 *
 * **Details**
 *
 * The first IPv6 address with a positive scope ID supplies the result. Accepts
 * the addresses of one interface, such as `os.networkInterfaces()[name]` or the
 * entries of `Deno.networkInterfaces()` with that name, without performing any
 * operating-system lookup itself.
 *
 * @see {@link scopeIdsFromInterfaces} for mapping every interface at once
 * @stability experimental
 * @category converting
 * @since 4.0.0
 */
export declare const scopeIdFromInterface: (addresses: ReadonlyArray<NetworkInterfaceAddress> | undefined) => Option.Option<number>;
/**
 * Creates a map from interface names to IPv6 scope IDs using supplied interface
 * entries.
 *
 * **Details**
 *
 * Each entry pairs an interface name with its addresses. The first IPv6 address
 * with a positive scope ID supplies that interface's mapping. Accepts entries
 * such as `Object.entries(os.networkInterfaces())` without performing any
 * operating-system lookup itself. Later changes to the entries do not affect
 * the map.
 *
 * @see {@link inetAddressFromHostString} for resolving named IPv6 zones with the map
 * @stability unstable
 * @category converting
 * @since 4.0.0
 */
export declare const scopeIdsFromInterfaces: (interfaces: Iterable<readonly [name: string, addresses: ReadonlyArray<NetworkInterfaceAddress> | undefined]>) => Map<string, number>;
/**
 * Parses `IPv4:port` or `[IPv6]:port` without DNS resolution.
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.0
 */
export declare const inetAddressFromString: (input: string) => Result.Result<InetAddress, NetAddressError>;
/**
 * Parses a trusted numeric internet address and port, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const inetAddressFromStringUnsafe: (input: string) => InetAddress;
/**
 * Converts an `InetAddressInput` to an internet address, parsing strings like
 * `inetAddressFromString`, converting parts like `inetAddressV4` and
 * `inetAddressV6`, and returning internet addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const inetAddressFromInput: (input: InetAddressInput) => Result.Result<InetAddress, NetAddressError>;
/**
 * Converts a trusted `InetAddressInput` to an internet address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const inetAddressFromInputUnsafe: (input: InetAddressInput) => InetAddress;
/**
 * Formats the numeric host of an internet address without brackets or a port,
 * preserving a nonzero IPv6 scope ID as a `%` suffix.
 *
 * **When to use**
 *
 * Use when the host and port are represented separately.
 *
 * @see {@link formatInet} for a complete socket address
 * @see {@link formatUrlHost} for a bracketed URL authority host
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatHost: (self: InetAddress) => string;
/**
 * Formats an internet address's host for a native socket API, without brackets
 * or a port.
 *
 * **Details**
 *
 * On `"win32"`, IPv6 zones remain numeric. On other platforms, the first
 * interface name matching the scope ID is used, falling back to the numeric ID
 * when no name matches. Unscoped IPv6 and IPv4 hosts are unchanged.
 *
 * Supply a scope map from {@link scopeIdsFromInterfaces} and optionally a platform
 * string. Omitting the platform uses non-Windows behavior. This function performs
 * no operating-system lookups.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatNativeHost: (self: InetAddress, scopeIds: ReadonlyMap<string, number>, platform?: string) => string;
/**
 * Formats an IPv4 address or IPv6 interface index for a native multicast API.
 *
 * **Details**
 *
 * IPv4 addresses are formatted as numeric IPs. An IPv6 index of zero produces
 * `"::"`. Other indices produce `"::%index"` on `"win32"`, or `"::%name"` on
 * other platforms using the first matching interface name, falling back to the
 * numeric index when no name matches.
 *
 * Supply a scope map from {@link scopeIdsFromInterfaces} and optionally a platform
 * string. Omitting the platform uses non-Windows behavior. This function performs
 * no operating-system lookups.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatMulticastInterface: (networkInterface: MulticastInterface, scopeIds: ReadonlyMap<string, number>, platform?: string) => string;
/**
 * Formats a resolved internet address, bracketing IPv6 around its port.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatInet: (self: InetAddress) => string;
/**
 * Formats an IP address for use as a URL authority host.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatUrlHost: (self: IpAddress) => string;
/**
 * Converts an IP address or internet socket address to a WHATWG `URL`.
 *
 * **Details**
 *
 * Defaults to the HTTP scheme and uses standard URL normalization, including
 * IPv6 brackets and omission of default ports. Bare IP addresses have no
 * explicit port; internet socket addresses retain their port, including zero.
 * Unspecified addresses are preserved.
 *
 * **Gotchas**
 *
 * Returns a `NetAddressError` for scoped IPv6 addresses or inputs that the URL
 * constructor rejects. Supply the scheme without a trailing colon, for example
 * `"https"`.
 *
 * @stability unstable
 * @category conversions
 * @since 4.0.0
 */
export declare const toUrl: (self: IpAddress | InetAddress, scheme?: string) => Result.Result<URL, NetAddressError>;
/**
 * Formats an IP or socket address as a URL display string.
 *
 * **Details**
 *
 * Defaults to HTTP, brackets IPv6 addresses, and omits default ports and the
 * trailing slash. Custom schemes such as `"tcp"` retain their scheme and host.
 * Unix socket addresses use {@link formatUnixPath}, preserving the raw path
 * with a `unix://` prefix regardless of the supplied scheme.
 *
 * **Gotchas**
 *
 * Returns a `NetAddressError` when URL conversion fails, including for scoped
 * IPv6 addresses.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatUrl: (self: IpAddress | SocketAddress, scheme?: string) => Result.Result<string, NetAddressError>;
/**
 * Formats an IP or socket address as a URL display string,
 * throwing a `NetAddressError` when conversion fails.
 *
 * @see {@link formatUrl} for the checked version and formatting behavior.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const formatUrlUnsafe: (self: IpAddress | SocketAddress, scheme?: string) => string;
/**
 * Formats a hostname or numeric IP address for use as a URL authority host.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatUrlHostString: (host: string) => string;
/**
 * Creates a Unix-domain filesystem address without normalizing its opaque path.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const unixPathAddress: (path: string) => UnixPathAddress;
/**
 * Formats a Unix-domain socket path as a readable `unix://path` display string.
 *
 * **Details**
 *
 * Preserves the raw path without URL encoding or normalization. The resulting
 * string is intended for display.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatUnixPath: (self: UnixPathAddress) => string;
/**
 * Converts a `SocketAddress.Input` to a concrete socket address.
 *
 * **Details**
 *
 * Internet addresses are converted like `inetAddressFromInput`, without
 * hostname resolution. Invalid IP literals, ports, and input shapes return a
 * `NetAddressError`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const socketAddressFromInput: (input: SocketAddress.Input) => Result.Result<SocketAddress, NetAddressError>;
/**
 * Converts a trusted `SocketAddress.Input` to a concrete socket address,
 * throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const socketAddressFromInputUnsafe: (input: SocketAddress.Input) => SocketAddress;
/**
 * Formats a portable socket address for human-readable output.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const formatSocketAddress: (self: SocketAddress) => string;
export {};
//# sourceMappingURL=NetAddress.d.ts.map