// Shared E2E setup: runs before each test file is imported, so NestJS module
// init (e.g. JwtStrategy) already sees a secret when suites boot AppModule.
// A secret supplied by the caller/test environment is never overwritten.
// This value is for tests only and must never be used outside the E2E suite.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET =
    'e2e-only-test-jwt-secret-not-for-production-0123456789';
}

// Test-only HMAC secret for auth rate-limit email buckets (C4-A). The
// auth-hardening suite enables RATE_LIMIT=on; without this default its
// bootstrap would fail closed before tests run. Never used outside e2e.
if (!process.env.RATE_LIMIT_HMAC_SECRET) {
  process.env.RATE_LIMIT_HMAC_SECRET =
    'e2e-only-test-hmac-secret-not-for-production-0123456789abcdef';
}

// Test-only REQUIRE_AUTH default (C4-1b). The pre-ownership E2E suites
// (lists, tasks, checklist, migration, prefix-cors, validation) exercise
// the anonymous legacy compatibility surface, so the shared harness runs
// in "off" mode unless a suite explicitly overrides it before booting its
// app. Never used outside the E2E suite.
if (!process.env.REQUIRE_AUTH) {
  process.env.REQUIRE_AUTH = 'off';
}
