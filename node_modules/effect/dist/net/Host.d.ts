/**
 * Host names and unresolved host and port endpoints.
 *
 * A `Host` is either a numeric IP address, an IPv6 literal with a zone such as
 * `fe80::1%eth0`, or a DNS domain name. Numeric addresses are parsed directly
 * into `NetAddress` values. The `AddressResolver` service turns a `HostPort`
 * into internet addresses, looking up domain names with the `Dns` service.
 *
 * @stability experimental
 * @since 4.0.0
 */
import type * as Arr from "../Array.ts";
import type * as Brand from "../Brand.ts";
import * as Equal from "../Equal.ts";
import * as Hash from "../Hash.ts";
import * as Inspectable from "../Inspectable.ts";
import * as Result from "../Result.ts";
import * as NetAddress from "./NetAddress.ts";
declare const TypeId: "~effect/net/Host";
/**
 * A syntactically valid DNS domain name in lowercase ASCII form.
 *
 * **Details**
 *
 * Names follow the rules used by Go's resolver: at most 253 characters, labels
 * of 1 to 63 letters, digits, hyphens, or underscores, and no label starting or
 * ending with a hyphen. Underscores are allowed so that service names such as
 * `_http._tcp.example.com` are valid. The last label must not be numeric, which
 * keeps IPv4-like strings out. A trailing dot marks a fully qualified name and
 * is preserved. The root name `.` is valid.
 *
 * Internationalized names are stored in their ASCII (`xn--`) form.
 *
 * @see {@link domainNameFromString} for parsing and normalizing domain names
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type DomainName = Brand.Branded<string, "~effect/net/Host/DomainName">;
/**
 * A domain name or a string to parse and normalize.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type DomainNameInput = DomainName | string;
/**
 * A host as written in configuration or a URL authority: a numeric IP address,
 * a scoped IPv6 literal, or a domain name.
 *
 * @see {@link hostFromString} for parsing hosts
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type Host = NetAddress.IpAddress | NetAddress.ScopedIpv6Literal | DomainName;
/**
 * A host, or a string or any `IpAddressInput` to convert to one.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type HostInput = Host | NetAddress.IpAddressInput;
/**
 * An unresolved host and port.
 *
 * @see {@link hostPortFromString} for parsing `host:port` strings
 * @see {@link formatHostPort} for formatting `host:port` strings
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface HostPort extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "HostPort";
    readonly host: Host;
    readonly port: number;
    readonly [TypeId]: typeof TypeId;
}
/**
 * The host and port of an endpoint.
 *
 * @see {@link hostPort} for the checked constructor
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface HostPortParts {
    readonly host: HostInput;
    readonly port: number;
}
/**
 * An endpoint, or a `host:port` string or parts to convert to one.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type HostPortInput = HostPort | string | HostPortParts;
/**
 * Returns `true` when a value is a valid, normalized domain name.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isDomainName: (u: unknown) => u is DomainName;
/**
 * Returns `true` when a value is a host.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isHost: (u: unknown) => u is Host;
/**
 * Returns `true` when a value is an unresolved host and port.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isHostPort: (u: unknown) => u is HostPort;
/**
 * Parses and normalizes a domain name.
 *
 * **Details**
 *
 * ASCII names are lowercased. Names containing non-ASCII characters are
 * converted to their ASCII (`xn--`) form using the WHATWG URL host parser, then
 * validated with the same rules as ASCII names. A trailing dot is preserved.
 *
 * **Example** (Normalizing domain names)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Host } from "effect/net"
 *
 * Result.getOrThrow(Host.domainNameFromString("Example.COM")) // => "example.com"
 * Result.getOrThrow(Host.domainNameFromString("bücher.example")) // => "xn--bcher-kva.example"
 * Result.isFailure(Host.domainNameFromString("1.2.3.4")) // => true
 * ```
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export declare const domainNameFromString: (input: string) => Result.Result<DomainName, NetAddress.NetAddressError>;
/**
 * Parses a trusted domain name, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const domainNameFromStringUnsafe: (input: string) => DomainName;
/**
 * Converts a `DomainNameInput` to a domain name, parsing and normalizing it like
 * `domainNameFromString`.
 *
 * **Details**
 *
 * Domain names are strings, so every input is parsed.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const domainNameFromInput: (input: DomainNameInput) => Result.Result<DomainName, NetAddress.NetAddressError>;
/**
 * Converts a trusted `DomainNameInput` to a domain name, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const domainNameFromInputUnsafe: (input: DomainNameInput) => DomainName;
/**
 * Parses a host as a numeric IP address, a scoped IPv6 literal, or a domain
 * name, in that order.
 *
 * **Example** (Parsing hosts)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Host, NetAddress } from "effect/net"
 *
 * NetAddress.isIpAddress(Result.getOrThrow(Host.hostFromString("10.0.0.5"))) // => true
 * Result.getOrThrow(Host.hostFromString("fe80::1%eth0")) // => "fe80::1%eth0"
 * Result.getOrThrow(Host.hostFromString("DB.internal")) // => "db.internal"
 * ```
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export declare const hostFromString: (input: string) => Result.Result<Host, NetAddress.NetAddressError>;
/**
 * Parses a trusted host, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const hostFromStringUnsafe: (input: string) => Host;
/**
 * Converts a `HostInput` to a host, parsing strings like `hostFromString` and
 * converting other inputs like `NetAddress.ipFromInput`.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const hostFromInput: (input: HostInput) => Result.Result<Host, NetAddress.NetAddressError>;
/**
 * Converts a trusted `HostInput` to a host, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const hostFromInputUnsafe: (input: HostInput) => Host;
/**
 * Formats a host without brackets.
 *
 * @stability experimental
 * @category encoding
 * @since 4.0.0
 */
export declare const formatHost: (self: Host) => string;
/**
 * Returns `true` when a domain name ends with a dot, which excludes it from
 * resolver search domains.
 *
 * @stability experimental
 * @category predicates
 * @since 4.0.0
 */
export declare const isFullyQualified: (self: DomainName) => boolean;
/**
 * Appends the trailing dot to a domain name, unless it is already fully
 * qualified.
 *
 * @stability experimental
 * @category converting
 * @since 4.0.0
 */
export declare const toFullyQualified: (self: DomainName) => DomainName;
/**
 * Removes the trailing dot of a fully qualified domain name, except from the
 * root name `.`.
 *
 * @stability experimental
 * @category converting
 * @since 4.0.0
 */
export declare const toRelative: (self: DomainName) => DomainName;
/**
 * Creates a checked host and port.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const hostPort: (host: Host, port: number) => Result.Result<HostPort, NetAddress.NetAddressError>;
/**
 * Creates a trusted host and port, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const hostPortUnsafe: (host: Host, port: number) => HostPort;
/**
 * Parses `host:port`, `[IPv6]:port`, or `[IPv6%zone]:port`.
 *
 * **Details**
 *
 * IPv6 hosts must be bracketed and other hosts must not be. The port is
 * required and must be an unpadded decimal integer from 0 through 65535. A
 * zone follows the `%` directly; the percent-encoded `%25` separator of RFC
 * 6874 URLs is not decoded, because `[fe80::1%253]:80` would be ambiguous.
 *
 * **Example** (Parsing host and port strings)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Host } from "effect/net"
 *
 * const endpoint = Result.getOrThrow(Host.hostPortFromString("DB.internal:5432"))
 * endpoint.host // => "db.internal"
 * endpoint.port // => 5432
 * Host.formatHostPort(Result.getOrThrow(Host.hostPortFromString("[::1]:80"))) // => "[::1]:80"
 * ```
 *
 * @see {@link formatHostPort} for the inverse operation
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export declare const hostPortFromString: (input: string) => Result.Result<HostPort, NetAddress.NetAddressError>;
/**
 * Parses a trusted `host:port` string, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const hostPortFromStringUnsafe: (input: string) => HostPort;
/**
 * Converts a `HostPortInput` to an endpoint, parsing strings like
 * `hostPortFromString`, converting parts like `hostPort`, and returning
 * endpoints unchanged.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const hostPortFromInput: (input: HostPortInput) => Result.Result<HostPort, NetAddress.NetAddressError>;
/**
 * Converts a trusted `HostPortInput` to an endpoint, throwing on failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export declare const hostPortFromInputUnsafe: (input: HostPortInput) => HostPort;
/**
 * Formats a host and port, bracketing IPv6 hosts.
 *
 * @see {@link hostPortFromString} for the inverse operation
 * @stability experimental
 * @category encoding
 * @since 4.0.0
 */
export declare const formatHostPort: (self: HostPort) => string;
/**
 * The addresses of host names, as read from a hosts file.
 *
 * @see {@link parseHostsFile} for reading a hosts file
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type HostsTable = ReadonlyMap<DomainName, Arr.NonEmptyReadonlyArray<NetAddress.IpAddress>>;
/**
 * Parses a hosts file into the addresses of each host name. Invalid entries
 * are skipped.
 *
 * **Example** (Parsing a hosts file)
 *
 * ```ts import.meta.vitest
 * import { Host, NetAddress } from "effect/net"
 *
 * const hosts = Host.parseHostsFile(`
 * 127.0.0.1 localhost
 * ::1       localhost ip6-localhost # loopback
 * `)
 * hosts.get(Host.domainNameFromStringUnsafe("localhost"))?.map(NetAddress.formatIp) // => ["127.0.0.1", "::1"]
 * ```
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export declare const parseHostsFile: (text: string) => HostsTable;
export {};
//# sourceMappingURL=Host.d.ts.map