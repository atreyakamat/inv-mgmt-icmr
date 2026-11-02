/**
 * Shared by the proxy (which sets it, after a real JWT check) and the server
 * (which reads it) — see proxy.ts for why this exists. An internal request
 * header, never trust a copy of this name/shape read from anywhere else.
 */
export const CLAIMS_HEADER = "x-sr-claims";

export type ForwardedClaims = { sub: string; email: string | null };
