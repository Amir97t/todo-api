import { Module, type ExecutionContext } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ThrottlerModule,
  ThrottlerStorageService,
  type ThrottlerGetTrackerFunction,
} from '@nestjs/throttler';
import { Redis } from '@upstash/redis';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { parseAuthRateLimitSettings, emailBucketKey } from './auth.config.js';
import { parseRequireAuthSettings } from './require-auth.config.js';
import { AuthRateLimitGuard } from './throttler/auth-rate-limit.guard.js';
import { UpstashRedisThrottlerStorage } from './throttler/upstash-redis.storage.js';
import { getClientIp } from '../common/get-client-ip.js';
import { REQUIRE_AUTH_MODE, ResourceScopeGuard } from './resource-scope.guard.js';
import { ResourceCsrfGuard } from './resource-csrf.guard.js';

function hasEmail(context: ExecutionContext): boolean {
  const req = context.switchToHttp().getRequest();
  return typeof req.body?.email === 'string' && req.body.email.trim() !== '';
}

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    // Auth endpoint rate limiting (C4-A). Settings are parsed once here at
    // bootstrap — never per request. Five named throttlers give each route
    // independent IP and (where an email is present) HMAC-email buckets;
    // each controller method @SkipThrottles the names that do not apply.
    // Provider "redis" uses Upstash shared counters and fails closed on any
    // Redis error; "memory" is the explicit local/Preview choice.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const settings = parseAuthRateLimitSettings(process.env);

        const storage =
          settings.enabled && settings.provider === 'redis'
            ? new UpstashRedisThrottlerStorage(
                new Redis({ url: settings.upstashUrl, token: settings.upstashToken }),
              )
            : new ThrottlerStorageService();

        const skipWhenDisabled = () => !settings.enabled;
        const ipTracker: ThrottlerGetTrackerFunction = (req) => `ip:${getClientIp(req)}`;
        const emailTracker: ThrottlerGetTrackerFunction = (req) =>
          `email:${emailBucketKey(settings.hmacSecret, String(req.body?.email ?? ''))}`;

        return {
          storage,
          getTracker: ipTracker,
          throttlers: [
            {
              name: 'login-ip',
              limit: settings.login.limit,
              ttl: settings.login.ttlMs,
              skipIf: skipWhenDisabled,
            },
            {
              name: 'login-email',
              limit: settings.login.limit,
              ttl: settings.login.ttlMs,
              getTracker: emailTracker,
              skipIf: (context) => skipWhenDisabled() || !hasEmail(context),
            },
            {
              name: 'register-ip',
              limit: settings.register.limit,
              ttl: settings.register.ttlMs,
              skipIf: skipWhenDisabled,
            },
            {
              name: 'register-email',
              limit: settings.register.limit,
              ttl: settings.register.ttlMs,
              getTracker: emailTracker,
              skipIf: (context) => skipWhenDisabled() || !hasEmail(context),
            },
            {
              name: 'refresh-ip',
              limit: settings.refresh.limit,
              ttl: settings.refresh.ttlMs,
              skipIf: skipWhenDisabled,
            },
          ],
        };
      },
    }),
  ],
  providers: [
    {
      provide: REQUIRE_AUTH_MODE,
      useFactory: () => parseRequireAuthSettings(process.env).mode,
    },
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    ResourceScopeGuard,
    ResourceCsrfGuard,
    CsrfService,
    CsrfGuard,
    AuthRateLimitGuard,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    JwtAuthGuard,
    JwtStrategy,
    ResourceScopeGuard,
    ResourceCsrfGuard,
    REQUIRE_AUTH_MODE,
    CsrfGuard,
    AuthRateLimitGuard,
  ],
})
export class AuthModule {}
