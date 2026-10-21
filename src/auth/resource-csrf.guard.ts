import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';
import { REQUIRE_AUTH_MODE } from './resource-scope.guard.js';
import type { RequireAuthMode } from './require-auth.config.js';

/**
 * CSRF enforcement for resource routes (lists, tasks, checklist), active
 * only when REQUIRE_AUTH=enforce. The existing CsrfGuard (allowlisted
 * Origin + double-submit cookie/header) is reused verbatim in enforce mode;
 * in off mode it is skipped entirely so the legacy anonymous frontend
 * workflow keeps working exactly as before C4-2. Safe methods (GET/HEAD/
 * OPTIONS) are already skipped inside CsrfGuard itself.
 *
 * Registered after ResourceScopeGuard, so an unauthenticated request is
 * rejected with 401 before any CSRF evaluation; ownership enforcement is
 * never bypassed because ResourceScopeGuard always runs first and the
 * controller still resolves req.resourceScope before touching data.
 */
@Injectable()
export class ResourceCsrfGuard implements CanActivate {
  constructor(
    @Inject(REQUIRE_AUTH_MODE) private readonly mode: RequireAuthMode,
    private readonly csrf: CsrfGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.mode === 'off') {
      return true;
    }

    return this.csrf.canActivate(context);
  }
}
