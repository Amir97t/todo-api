import { describe, it, expect } from 'vitest';
import { parseRequireAuthSettings } from './require-auth.config.js';

describe('parseRequireAuthSettings', () => {
  it('defaults to enforce when REQUIRE_AUTH is missing', () => {
    expect(parseRequireAuthSettings({})).toEqual({
      mode: 'enforce',
      invalidValue: false,
    });
  });

  it('defaults to enforce when REQUIRE_AUTH is empty or whitespace', () => {
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: '' }).mode).toBe('enforce');
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: '   ' }).mode).toBe('enforce');
  });

  it('accepts "off" and "enforce", case-insensitively', () => {
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: 'off' })).toEqual({
      mode: 'off',
      invalidValue: false,
    });
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: 'OFF' }).mode).toBe('off');
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: 'enforce' })).toEqual({
      mode: 'enforce',
      invalidValue: false,
    });
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: ' Enforce ' }).mode).toBe(
      'enforce',
    );
  });

  it('fails closed to enforce for invalid values', () => {
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: 'maybe' })).toEqual({
      mode: 'enforce',
      invalidValue: true,
    });
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: '1' }).mode).toBe('enforce');
    expect(parseRequireAuthSettings({ REQUIRE_AUTH: 'true' }).invalidValue).toBe(
      true,
    );
  });
});
