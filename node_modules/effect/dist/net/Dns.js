/**
 * Host name resolution, DNS queries, and DNS record values.
 *
 * `lookup` resolves a host name to the addresses used to connect to it,
 * `resolve` queries DNS records of one type, and `reverse` looks up the names
 * of an address. Runtime packages provide the `Dns` service from the host
 * platform's resolver, whose `lookup` uses the operating system resolver
 * (`getaddrinfo`) and therefore also reads the hosts file and other system
 * sources, not only DNS. `AddressResolver` builds on `lookup` to resolve
 * `host:port` endpoints.
 *
 * @stability experimental
 * @since 4.0.0
 */
import * as Arr from "../Array.js";
import * as Context from "../Context.js";
import * as Data from "../Data.js";
import * as Duration from "../Duration.js";
import * as Effect from "../Effect.js";
import * as Hex from "../encoding/Hex.js";
import * as Equal from "../Equal.js";
import * as Hash from "../Hash.js";
import * as Inspectable from "../Inspectable.js";
import * as Layer from "../Layer.js";
import { hasProperty } from "../Predicate.js";
import * as Result from "../Result.js";
import * as Host from "./Host.js";
import * as NetAddress from "./NetAddress.js";
const RecordTypeId = "~effect/net/Dns/DnsRecord";
const isUint8 = u => Number.isInteger(u) && u >= 0 && u <= 0xff;
const isUint16 = u => Number.isInteger(u) && u >= 0 && u <= 0xffff;
const isUint32 = u => Number.isInteger(u) && u >= 0 && u <= 0xffffffff;
const isString = u => typeof u === "string";
// SOA timers are 32-bit unsigned counts of seconds on the wire.
const isTimer = u => Duration.isDuration(u) && Duration.isFinite(u) && isUint32(Duration.toSeconds(u));
const recordFields = {
  A: {
    address: NetAddress.isIpv4Address
  },
  AAAA: {
    address: NetAddress.isIpv6Address
  },
  CAA: {
    critical: u => typeof u === "boolean",
    tag: u => isString(u) && /^[a-z0-9]+$/i.test(u),
    value: isString
  },
  CNAME: {
    target: Host.isDomainName
  },
  MX: {
    exchange: Host.isDomainName,
    priority: isUint16
  },
  NAPTR: {
    order: isUint16,
    preference: isUint16,
    flags: isString,
    service: isString,
    regexp: isString,
    replacement: Host.isDomainName
  },
  NS: {
    host: Host.isDomainName
  },
  PTR: {
    host: u => isString(u) && u.length > 0
  },
  SOA: {
    primary: Host.isDomainName,
    admin: u => isString(u) && u.length > 0,
    serial: isUint32,
    refresh: isTimer,
    retry: isTimer,
    expire: isTimer,
    minimum: isTimer
  },
  SRV: {
    target: Host.isDomainName,
    port: isUint16,
    priority: isUint16,
    weight: isUint16
  },
  TLSA: {
    certUsage: isUint8,
    selector: isUint8,
    matchingType: isUint8,
    data: u => u instanceof Uint8Array && u.length > 0
  },
  TXT: {
    chunks: u => Array.isArray(u) && u.length > 0 && u.every(isString)
  }
};
/**
 * Every supported record type.
 *
 * @stability experimental
 * @category constants
 * @since 4.0.0
 */
export const recordTypes = /*#__PURE__*/Object.keys(recordFields);
/**
 * Returns `true` when a value is a supported record type.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export const isRecordType = u => recordTypes.includes(u);
/**
 * Returns `true` when a value is a DNS record.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export const isDnsRecord = u => hasProperty(u, RecordTypeId);
const RecordPrototype = {
  ...Inspectable.BaseProto,
  [RecordTypeId]: RecordTypeId,
  [Equal.symbol](that) {
    return isDnsRecord(that) && that._tag === this._tag && Object.keys(this).every(key => Equal.equals(this[key], that[key]));
  },
  [Hash.symbol]() {
    return Hash.structureKeys(this, Object.keys(this));
  },
  toString() {
    return formatRecord(this);
  },
  toJSON() {
    return {
      ...this
    };
  }
};
/**
 * Creates a checked DNS record of a record type from its fields.
 *
 * **Details**
 *
 * Every field is checked at runtime: addresses must belong to the record's
 * address family, names must be normalized domain names, priorities, weights,
 * and ports must be 16-bit unsigned integers, the SOA serial and timers must be
 * 32-bit unsigned integers (the timers in whole seconds), the TLSA fields must
 * be 8-bit unsigned integers with non-empty `data`, which is copied, TXT
 * records need at least one chunk, and CAA property tags must be alphanumeric.
 * Fields that do not belong to the record type are ignored.
 *
 * **Example** (Creating a service record)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Dns, Host } from "effect/net"
 *
 * const record = Result.getOrThrow(Dns.makeRecord("SRV", {
 *   target: Host.domainNameFromStringUnsafe("db.internal"),
 *   port: 5432,
 *   priority: 10,
 *   weight: 5
 * }))
 * Dns.formatRecord(record) // => "SRV 10 5 5432 db.internal"
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const makeRecord = (type, fields) => {
  if (!isRecordType(type)) {
    return Result.fail(new NetAddress.NetAddressError({
      input: type,
      message: "unknown DNS record type"
    }));
  }
  const input = typeof fields === "object" && fields !== null ? fields : {};
  const self = Object.create(RecordPrototype);
  self._tag = type;
  for (const [key, check] of Object.entries(recordFields[type])) {
    const value = input[key];
    if (!check(value)) {
      return Result.fail(new NetAddress.NetAddressError({
        input: fields,
        message: `invalid ${type} record ${key}`
      }));
    }
    self[key] = Array.isArray(value) ? Object.freeze([...value]) : value instanceof Uint8Array ? new Uint8Array(value) : value;
  }
  return Result.succeed(Object.freeze(self));
};
/**
 * Creates a trusted DNS record of a record type from its fields, throwing on
 * failure.
 *
 * @stability experimental
 * @category unsafe
 * @since 4.0.0
 */
export const makeRecordUnsafe = (type, fields) => Result.getOrThrow(makeRecord(type, fields));
const encoder = /*#__PURE__*/new TextEncoder();
const decimalEscape = byte => `\\${byte.toString().padStart(3, "0")}`;
// Quotes a character string in DNS presentation format (RFC 1035, section 5.1):
// `"` and `\` are escaped, and bytes outside printable ASCII are written as `\DDD`.
const quote = value => {
  let out = "\"";
  for (const byte of encoder.encode(value)) {
    out += byte === 0x22 || byte === 0x5c ? `\\${String.fromCharCode(byte)}` : byte < 0x20 || byte > 0x7e ? decimalEscape(byte) : String.fromCharCode(byte);
  }
  return out + "\"";
};
const nameSpecials = [0x22, 0x24, 0x28, 0x29, 0x3b, 0x40];
// Writes a name held as text, such as `Ptr.host`, in DNS presentation format:
// its `\.` and `\\` escapes are kept, other special characters are escaped, and
// spaces and bytes outside printable ASCII are written as `\DDD`.
const formatName = text => {
  const bytes = encoder.encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x5c) {
      const next = bytes[i + 1];
      if (next === 0x2e || next === 0x5c) {
        out += `\\${String.fromCharCode(next)}`;
        i++;
      } else {
        out += "\\\\";
      }
    } else if (byte <= 0x20 || byte > 0x7e) {
      out += decimalEscape(byte);
    } else {
      out += nameSpecials.includes(byte) ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte);
    }
  }
  return out;
};
/**
 * Formats a record in DNS presentation format, prefixed by its type.
 *
 * @stability experimental
 * @category encoding
 * @since 4.0.0
 */
export const formatRecord = self => {
  switch (self._tag) {
    case "A":
    case "AAAA":
      return `${self._tag} ${NetAddress.formatIp(self.address)}`;
    case "CAA":
      return `CAA ${self.critical ? 128 : 0} ${self.tag} ${quote(self.value)}`;
    case "CNAME":
      return `CNAME ${self.target}`;
    case "MX":
      return `MX ${self.priority} ${self.exchange}`;
    case "NAPTR":
      return `NAPTR ${self.order} ${self.preference} ${quote(self.flags)} ${quote(self.service)} ${quote(self.regexp)} ${self.replacement}`;
    case "NS":
      return `NS ${self.host}`;
    case "PTR":
      return `PTR ${formatName(self.host)}`;
    case "SOA":
      return `SOA ${self.primary} ${formatName(self.admin)} ${self.serial} ${Duration.toSeconds(self.refresh)} ${Duration.toSeconds(self.retry)} ${Duration.toSeconds(self.expire)} ${Duration.toSeconds(self.minimum)}`;
    case "SRV":
      return `SRV ${self.priority} ${self.weight} ${self.port} ${self.target}`;
    case "TLSA":
      return `TLSA ${self.certUsage} ${self.selector} ${self.matchingType} ${Hex.encode(self.data).toUpperCase()}`;
    case "TXT":
      return `TXT ${self.chunks.map(quote).join(" ")}`;
  }
};
/**
 * Returns the reverse-lookup domain name for an IP address, in `in-addr.arpa`
 * for IPv4 or `ip6.arpa` for IPv6.
 *
 * **Example** (Building reverse-lookup names)
 *
 * ```ts import.meta.vitest
 * import { Dns, NetAddress } from "effect/net"
 *
 * Dns.reverseName(NetAddress.ipFromStringUnsafe("192.0.2.1")) // => "1.2.0.192.in-addr.arpa"
 * ```
 *
 * @stability experimental
 * @category converting
 * @since 4.0.0
 */
export const reverseName = address => {
  if (NetAddress.isIpv4Address(address)) {
    return `${[...NetAddress.ipv4ToOctets(address)].reverse().join(".")}.in-addr.arpa`;
  }
  const nibbles = [];
  for (const octet of NetAddress.ipv6ToOctets(address)) {
    nibbles.push((octet >> 4).toString(16), (octet & 0xf).toString(16));
  }
  return `${nibbles.reverse().join(".")}.ip6.arpa`;
};
// =============================================================================
// Name servers
// =============================================================================
/**
 * Parses the address of a name server: an IP address, which uses port 53, or
 * an IP address and port.
 *
 * **Details**
 *
 * IPv6 addresses with a port are written in brackets, and IPv6 addresses
 * without one are not.
 *
 * **Example** (Parsing name server addresses)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Dns, NetAddress } from "effect/net"
 *
 * const format = (input: string) => Result.map(Dns.nameServerFromString(input), NetAddress.formatInet)
 *
 * format("192.0.2.53") // => Result.succeed("192.0.2.53:53")
 * format("2001:db8::53") // => Result.succeed("[2001:db8::53]:53")
 * format("[2001:db8::53]:5353") // => Result.succeed("[2001:db8::53]:5353")
 * Result.isFailure(format("ns.example")) // => true
 * ```
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.0
 */
export const nameServerFromString = input => NetAddress.inetAddressFromString(input.startsWith("[") || /^[^:]*:\d+$/.test(input) ? input : input.includes(":") ? `[${input}]:53` : `${input}:53`);
/**
 * Converts a name server to the internet address to query. Strings are parsed
 * like `nameServerFromString`, internet addresses and address parts with a
 * port are converted like `NetAddress.inetAddressFromInput`, and other IP
 * address inputs are converted like `NetAddress.ipFromInput` and use port 53.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const nameServerFromInput = input => typeof input === "string" ? nameServerFromString(input) : "port" in input ? NetAddress.inetAddressFromInput(input) : Result.map(NetAddress.ipFromInput(input), address => NetAddress.inetAddressUnsafe(address, 53));
/**
 * A failed lookup, query, or reverse lookup.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DnsError extends /*#__PURE__*/Data.TaggedError("DnsError") {
  /**
   * Formats the reason, operation, and name of the failed resolution.
   *
   * @since 4.0.0
   */
  get message() {
    return `${this.reason}: Dns.${this.method} (${this.hostname}${this.recordType === undefined ? "" : ` ${this.recordType}`})`;
  }
  /**
   * Whether the failure is transient and the operation may succeed if retried.
   *
   * @since 4.0.0
   */
  get isTemporary() {
    return this.reason === "Timeout" || this.reason === "Temporary" || this.reason === "ServerFailure";
  }
}
/**
 * Service that resolves names to addresses, queries DNS records, and looks up
 * the names of addresses.
 *
 * **Details**
 *
 * Every operation either returns at least one result or fails with a
 * {@link DnsError}.
 *
 * @stability experimental
 * @category services
 * @since 4.0.0
 */
export class Dns extends /*#__PURE__*/Context.Service()("effect/net/Dns") {}
const notFound = (method, hostname, recordType) => Effect.fail(new DnsError({
  reason: "NotFound",
  method,
  hostname,
  recordType
}));
const badName = (method, hostname, cause, recordType) => Effect.fail(new DnsError({
  reason: "BadName",
  method,
  hostname,
  recordType,
  cause
}));
const asciiName = /^[\w.-]+$/;
/**
 * Creates a `Dns` service from platform resolver operations.
 *
 * **Details**
 *
 * Lookup and query names are parsed and normalized, and reverse lookup
 * addresses are parsed, before platform callbacks receive them. Invalid names
 * and addresses fail with `BadName`.
 *
 * The constructor filters lookups by the requested address family, keeps only
 * records of the requested type, removes duplicates, and turns empty results
 * into `NotFound` failures. `reverse` receives the names of an address and
 * keeps those that are valid host names, failing with `InvalidResponse` when
 * there are names but none is valid. Without a `reverse` operation, the names
 * are those of the PTR records at the address's `reverseName`, and failures of
 * that query are reported as failures of `reverse`.
 *
 * Only `lookup` is required. Platforms that can resolve addresses but cannot
 * query records, such as browsers, omit `resolve`; record queries, and reverse
 * lookups without a `reverse` operation, then fail with `Unsupported`.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const make = impl => {
  const inFamily = family => address => family === undefined || NetAddress.isFamily(address, family);
  const resolveRecords = impl.resolve ?? ((name, type) => Effect.fail(new DnsError({
    reason: "Unsupported",
    method: "resolve",
    hostname: name,
    recordType: type
  })));
  const reverseNames = impl.reverse ?? (address => resolveRecords(reverseName(address), "PTR").pipe(Effect.map(Arr.flatMap(record => record._tag === "PTR" ? [record.host] : [])), Effect.mapError(error => new DnsError({
    reason: error.reason,
    method: "reverse",
    hostname: NetAddress.formatIp(address),
    cause: error.cause
  }))));
  const lookup = (input, options) => Result.match(Host.domainNameFromInput(input), {
    onFailure: cause => badName("lookup", input, cause),
    onSuccess: host => impl.lookup(host, options?.family).pipe(Effect.flatMap(addresses => Arr.match(Arr.dedupe(addresses.filter(inFamily(options?.family))), {
      onEmpty: () => notFound("lookup", host),
      onNonEmpty: Effect.succeed
    })))
  });
  return Dns.of({
    lookup,
    resolve: (input, type) => Result.match(Host.domainNameFromInput(input), {
      onFailure: cause => badName("resolve", input, cause, type),
      onSuccess: name => resolveRecords(name, type).pipe(Effect.flatMap(records => Arr.match(Arr.dedupe(records.filter(record => record._tag === type)), {
        onEmpty: () => notFound("resolve", name, type),
        onNonEmpty: Effect.succeed
      })))
    }),
    reverse: input => Result.match(NetAddress.ipFromInput(input), {
      onFailure: cause => badName("reverse", String(input), cause),
      onSuccess: address => reverseNames(address).pipe(Effect.flatMap(names => {
        const hostname = NetAddress.formatIp(address);
        // Only ASCII names: `domainNameFromString` would convert UTF-8 labels
        // to a different, `xn--` name.
        const hosts = Arr.dedupe(Arr.filterMap(names.filter(name => asciiName.test(name)), Host.domainNameFromString));
        return Arr.isReadonlyArrayNonEmpty(hosts) ? Effect.succeed(hosts) : names.length > 0 ? Effect.fail(new DnsError({
          reason: "InvalidResponse",
          method: "reverse",
          hostname
        })) : notFound("reverse", hostname);
      }))
    })
  });
};
const zoneKey = name => name.length > 1 && name.endsWith(".") ? name.slice(0, -1) : name;
/**
 * Creates a `Dns` service that answers from fixed data.
 *
 * **When to use**
 *
 * Use to test code that depends on `Dns`, or to provide fixed names on
 * platforms without a resolver.
 *
 * **Details**
 *
 * Names without matching addresses or records fail with `NotFound`. CNAME
 * records are returned by `CNAME` queries but are not followed.
 *
 * **Example** (Looking up a name with a static resolver)
 *
 * ```ts import.meta.vitest
 * import { Effect, Result } from "effect"
 * import { Dns, NetAddress } from "effect/net"
 *
 * const dns = Result.getOrThrow(Dns.makeStatic({
 *   hosts: { "db.internal": ["10.0.0.5"] }
 * }))
 *
 * const program = dns.lookup("db.internal").pipe(
 *   Effect.map((addresses) => addresses.map(NetAddress.formatIp))
 * )
 *
 * await Effect.runPromise(program) // => ["10.0.0.5"]
 * ```
 *
 * @see {@link layerStatic}
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const makeStatic = zone => {
  const entries = new Map();
  const entry = name => Result.map(Host.domainNameFromString(name), domain => {
    const key = zoneKey(domain);
    let current = entries.get(key);
    if (current === undefined) {
      current = {
        addresses: [],
        records: []
      };
      entries.set(key, current);
    }
    return current;
  });
  for (const [name, addresses] of Object.entries(zone.hosts ?? {})) {
    const result = entry(name);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    for (const input of addresses) {
      const address = NetAddress.ipFromInput(input);
      if (Result.isFailure(address)) return Result.fail(address.failure);
      result.success.addresses.push(address.success);
    }
  }
  for (const [name, records] of Object.entries(zone.records ?? {})) {
    const result = entry(name);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    for (const record of records) {
      if (!isDnsRecord(record)) {
        return Result.fail(new NetAddress.NetAddressError({
          input: record,
          message: "expected a DNS record"
        }));
      }
      result.success.records.push(record);
    }
  }
  const recordsAt = name => entries.get(zoneKey(name))?.records ?? [];
  return Result.succeed(make({
    lookup: host => Effect.sync(() => [...(entries.get(zoneKey(host))?.addresses ?? []), ...recordsAt(host).flatMap(record => record._tag === "A" || record._tag === "AAAA" ? [record.address] : [])]),
    resolve: name => Effect.sync(() => recordsAt(name)),
    reverse: address => Effect.sync(() => [...[...entries].flatMap(([name, current]) => current.addresses.some(candidate => Equal.equals(candidate, address)) ? [name] : []), ...recordsAt(reverseName(address)).flatMap(record => record._tag === "PTR" ? [record.host] : [])])
  }));
};
/**
 * Creates a layer that provides a `Dns` service answering from fixed data.
 *
 * @see {@link makeStatic} for the resolution rules
 * @stability experimental
 * @category layers
 * @since 4.0.0
 */
export const layerStatic = zone => Layer.effect(Dns, Effect.fromResult(makeStatic(zone)));
//# sourceMappingURL=Dns.js.map