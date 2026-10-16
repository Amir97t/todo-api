export type RequireAuthMode = 'off' | 'enforce';

export interface RequireAuthSettings {
  mode: RequireAuthMode;
  /** True when REQUIRE_AUTH was set but neither "off" nor "enforce". */
  invalidValue: boolean;
}

/**
 * Read-once REQUIRE_AUTH settings. Missing or invalid values fail closed to
 * "enforce". Called at bootstrap (main.ts validation and the
 * ResourceScopeGuard provider factory), never per request.
 */
export function parseRequireAuthSettings(
  env: Record<string, string | undefined>,
): RequireAuthSettings {
  const raw = (env['REQUIRE_AUTH'] ?? '').trim().toLowerCase();

  if (raw === '') {
    return { mode: 'enforce', invalidValue: false };
  }
  if (raw === 'off' || raw === 'enforce') {
    return { mode: raw, invalidValue: false };
  }
  return { mode: 'enforce', invalidValue: true };
}
