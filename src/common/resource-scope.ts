/**
 * Resource ownership scope resolved per request by ResourceScopeGuard and
 * carried on req.resourceScope. Kept separate from Passport's req.user so
 * JWT claims and ownership scoping never share a shape.
 */
export type ResourceScope = { userId: string } | { legacy: true };

export function isLegacyScope(
  scope: ResourceScope,
): scope is { legacy: true } {
  return 'legacy' in scope;
}

declare global {
  namespace Express {
    interface Request {
      resourceScope?: ResourceScope;
    }
  }
}
