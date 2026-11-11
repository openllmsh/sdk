/**
 * IPv4 and IPv6 interface addresses that preserve host bits alongside a prefix length.
 *
 * @stability unstable
 * @since 4.0.0
 */
import * as Equal from "../Equal.ts";
import * as Hash from "../Hash.ts";
import * as Inspectable from "../Inspectable.ts";
import * as Result from "../Result.ts";
import * as NetAddress from "./NetAddress.ts";
declare const TypeId: "~effect/net/IpInterface";
/**
 * An IP host address and prefix length. Host bits and any verified address
 * refinements are preserved because the address is retained unchanged. Code
 * that computes different address bits must widen to the IPv4 or IPv6 family,
 * or validate the resulting address before treating it as refined.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface IpInterface<out A extends NetAddress.IpAddress = NetAddress.IpAddress> extends Equal.Equal, Hash.Hash, Inspectable.Inspectable {
    readonly _tag: "IpInterface";
    readonly address: A;
    readonly prefixLength: number;
    readonly [TypeId]: typeof TypeId;
}
/**
 * An IPv4 host address and prefix length.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv4Interface = IpInterface<NetAddress.Ipv4Address>;
/**
 * An IPv6 host address and prefix length.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv6Interface = IpInterface<NetAddress.Ipv6Address>;
/**
 * An address and prefix length, generic over the accepted address input.
 *
 * @see {@link make} for the checked constructor
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface IpInterfaceParts<A extends NetAddress.IpAddressInput = NetAddress.IpAddressInput> {
    readonly address: A;
    readonly prefixLength: number;
}
/**
 * An interface address, or a string or parts to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type IpInterfaceInput = IpInterface | string | IpInterfaceParts;
/**
 * An IPv4 interface address, or a string or parts to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv4InterfaceInput = Ipv4Interface | string | IpInterfaceParts<NetAddress.Ipv4AddressInput>;
/**
 * An IPv6 interface address, or a string or parts to convert to one.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Ipv6InterfaceInput = Ipv6Interface | string | IpInterfaceParts<NetAddress.Ipv6AddressInput>;
/**
 * Companion types for parsing IP interface addresses.
 *
 * @stability unstable
 * @since 4.0.0
 */
export declare namespace IpInterface {
    /**
     * Controls whether the input must contain an explicit prefix. Prefixes are
     * optional by default and use the address width when omitted.
     *
     * @stability unstable
     * @category models
     * @since 4.0.0
     */
    interface ParseOptions {
        readonly prefix?: "required" | "optional";
    }
}
/**
 * Returns `true` when a value is an IPv4 interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpv4Interface: (u: unknown) => u is Ipv4Interface;
/**
 * Returns `true` when a value is an IPv6 interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpv6Interface: (u: unknown) => u is Ipv6Interface;
/**
 * Returns `true` when a value is an IP interface address.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isIpInterface: (u: unknown) => u is IpInterface;
/**
 * Creates an interface address while preserving all address bits.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const make: <A extends NetAddress.IpAddress>(address: A, prefixLength: number) => Result.Result<IpInterface<A>, NetAddress.NetAddressError>;
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
export declare const ipv4FromString: (input: string, options?: IpInterface.ParseOptions) => Result.Result<Ipv4Interface, NetAddress.NetAddressError>;
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
export declare const ipv6FromString: (input: string, options?: IpInterface.ParseOptions) => Result.Result<Ipv6Interface, NetAddress.NetAddressError>;
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
export declare const fromString: (input: string, options?: IpInterface.ParseOptions) => Result.Result<IpInterface, NetAddress.NetAddressError>;
/**
 * Converts an `Ipv4InterfaceInput` to an IPv4 interface address, parsing
 * strings like `ipv4FromString` with the given options, converting parts like
 * `make`, and returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv4FromInput: (input: Ipv4InterfaceInput, options?: IpInterface.ParseOptions) => Result.Result<Ipv4Interface, NetAddress.NetAddressError>;
/**
 * Converts an `Ipv6InterfaceInput` to an IPv6 interface address, parsing
 * strings like `ipv6FromString` with the given options, converting parts like
 * `make`, and returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const ipv6FromInput: (input: Ipv6InterfaceInput, options?: IpInterface.ParseOptions) => Result.Result<Ipv6Interface, NetAddress.NetAddressError>;
/**
 * Converts an `IpInterfaceInput` to an interface address, parsing strings like
 * `fromString` with the given options, converting parts like `make`, and
 * returning interface addresses unchanged.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const fromInput: (input: IpInterfaceInput, options?: IpInterface.ParseOptions) => Result.Result<IpInterface, NetAddress.NetAddressError>;
/**
 * Converts a trusted `IpInterfaceInput` to an interface address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const fromInputUnsafe: (input: IpInterfaceInput, options?: IpInterface.ParseOptions) => IpInterface;
/**
 * Creates a trusted interface address, throwing when its prefix length is invalid.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const makeUnsafe: <A extends NetAddress.IpAddress>(address: A, prefixLength: number) => IpInterface<A>;
/**
 * Parses a trusted interface address, throwing on failure.
 *
 * @stability unstable
 * @category unsafe
 * @since 4.0.0
 */
export declare const fromStringUnsafe: (input: string, options?: IpInterface.ParseOptions) => IpInterface;
/**
 * Formats an interface address using canonical address text and its decimal prefix length.
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.0
 */
export declare const format: (self: IpInterface) => string;
export {};
//# sourceMappingURL=IpInterface.d.ts.map