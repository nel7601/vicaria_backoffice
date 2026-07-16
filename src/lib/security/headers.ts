/**
 * Security response headers (spec SEC-03, SEC-07, NFR-04).
 * Applied on every response by the proxy. The CSP is intentionally strict;
 * adjust `connect-src` to the Supabase project origin at deploy time.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // HSTS: only meaningful over HTTPS; harmless otherwise.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
}
