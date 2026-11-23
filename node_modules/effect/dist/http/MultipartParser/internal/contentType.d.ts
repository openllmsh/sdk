export declare function parse(header: string | undefined): {
    readonly value: string;
    readonly parameters: Record<string, string>;
};
export interface ContentDisposition {
    readonly value: string;
    readonly parameters: Record<string, string>;
    /** `filename*` decoded per RFC 8187, falling back to `filename` */
    readonly filename: string | undefined;
}
/**
 * Parses a Content-Disposition header according to RFC 6266, returning
 * `undefined` when it is malformed, repeats a parameter or carries an
 * undecodable `filename*`.
 *
 * Quoted-pairs are left as-is, so unescaped backslashes in file paths survive.
 */
export declare function parseDisposition(header: string | ReadonlyArray<string> | undefined): ContentDisposition | undefined;
//# sourceMappingURL=contentType.d.ts.map