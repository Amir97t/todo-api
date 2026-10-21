import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { getCorsOrigins } from '../configure-app.js';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // Every state-changing request must carry an explicit, allowlisted
    // Origin. Browsers always send Origin on non-GET fetch/form posts,
    // including same-origin ones, so a missing Origin is rejected here.
    // "Origin: null" (e.g. sandboxed frames) is not in the allowlist and is
    // rejected by the same check. The allowlist is the exact same env-driven
    // source as CORS (single source of truth; no wildcard origins).
    const origin = request.headers.origin;
    const allowedOrigins = getCorsOrigins();
    if (!origin || origin === 'null' || !allowedOrigins.includes(origin)) {
      throw new ForbiddenException({ code: 'ORIGIN_INVALID', message: 'Invalid origin' });
    }

    const csrfCookie = request.cookies?.csrfToken;
    const csrfHeader = request.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'Invalid CSRF token' });
    }

    return true;
  }
}