import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import cookieParser from 'cookie-parser';
import { parseAuthRateLimitSettings } from './auth/auth.config.js';
import { parseRequireAuthSettings } from './auth/require-auth.config.js';

function validateConfig(): void {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured. Set it in .env before starting.');
  }
  // Fail fast on missing/invalid rate-limit configuration. Throws with the
  // offending variable NAME only — never a value.
  parseAuthRateLimitSettings(process.env);
  // Missing/invalid REQUIRE_AUTH fails closed to "enforce"; diagnostics are
  // logged below without echoing any value.
  parseRequireAuthSettings(process.env);
}

async function bootstrap() {
  validateConfig();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  configureApp(app);
  app.enableShutdownHooks();

  const requireAuth = parseRequireAuthSettings(process.env);
  if (requireAuth.invalidValue) {
    console.warn(
      'REQUIRE_AUTH has an invalid value; failing closed to "enforce".',
    );
  }
  console.log(`REQUIRE_AUTH mode: ${requireAuth.mode}`);

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});