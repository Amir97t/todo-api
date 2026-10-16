import {
  Inject,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequireAuthMode } from './require-auth.config.js';
import type { ResourceScope } from '../common/resource-scope.js';

export const REQUIRE_AUTH_MODE = 'REQUIRE_AUTH_MODE';

@Injectable()
export class ResourceScopeGuard extends AuthGuard('jwt') {
  constructor(
    @Inject(REQUIRE_AUTH_MODE) private readonly mode: RequireAuthMode,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const hasBearer =
      typeof request.headers.authorization === 'string' &&
      request.headers.authorization.startsWith('Bearer ');

    if (!hasBearer) {
      if (this.mode === 'enforce') {
        throw new UnauthorizedException();
      }
      request.resourceScope = { legacy: true };
      return true;
    }

    // A header is present, so it is always validated. In "off" mode a
    // malformed/expired token still fails closed to 401 — never a silent
    // downgrade to the anonymous legacy scope.
    const valid = await super.canActivate(context);
    if (!valid) {
      return false;
    }

    const user = (request as Request & { user?: { userId?: string } }).user;
    if (!user?.userId) {
      throw new UnauthorizedException();
    }

    request.resourceScope = { userId: user.userId } satisfies ResourceScope;
    return true;
  }
}
