/**
 * Structural view of the request fields used here. Kept compatible with both
 * Express's Request and the throttler's `Record<string, any>` tracker input.
 */
export interface ClientIpRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Client IP for rate-limit bucketing.
 *
 * Uses Express `req.ip`, which honors the app-level `trust proxy` setting
 * and therefore applies the spoof-resistant rightmost-untrusted-hop parse
 * of the X-Forwarded-For chain that the trusted edge (Vercel) controls.
 * Raw X-Forwarded-For / X-Real-IP headers are deliberately never read here:
 * a client-supplied header must not be able to mint a fresh bucket.
 */
export function getClientIp(req: ClientIpRequest): string {
  if (req.ip) {
    return req.ip;
  }
  return req.socket?.remoteAddress ?? '0.0.0.0';
}
