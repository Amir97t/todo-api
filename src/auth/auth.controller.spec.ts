import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { ThrottlerModule } from '@nestjs/throttler';

describe('AuthController', () => {
  let controller: AuthController;
  let mockResponse: Partial<Response>;

  const mockAuthService = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    revokeTokenFamily: vi.fn(),
  };

  const mockReq = (cookies: Record<string, string> = {}) => ({
    cookies,
  } as unknown as Request);

  const createMockResponse = () => {
    const cookies: Record<string, { value: string; options: any }> = {};
    const clearedCookies: Record<string, any> = {};

    return {
      cookie: vi.fn((name: string, value: string, options: any) => {
        cookies[name] = { value, options };
      }),
      clearCookie: vi.fn((name: string, options: any) => {
        clearedCookies[name] = options;
      }),
      getCookies: () => cookies,
      getClearedCookies: () => clearedCookies,
    } as unknown as Response & { getCookies: () => typeof cookies; getClearedCookies: () => typeof clearedCookies };
  };

  const createModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      // AuthController is annotated with @UseGuards(AuthRateLimitGuard);
      // Nest instantiates guard classes as enhancers regardless of provider
      // overrides, so the tokens ThrottlerGuard injects must be available.
      // Guards never run here — this spec calls controller methods directly.
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'unit', limit: 10, ttl: 60_000 }] })],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: JwtService, useValue: { sign: vi.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: CsrfService, useValue: { validate: vi.fn() } },
        { provide: CsrfGuard, useValue: { canActivate: vi.fn().mockReturnValue(true) } },
      ],
    }).compile();

    return module.get<AuthController>(AuthController);
  };

  const runTests = (envName: string, expectedSecure: boolean) => {
    describe(`${envName} (secure=${expectedSecure})`, () => {
      beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubEnv('NODE_ENV', envName === 'production' ? 'production' : 'development');
        vi.stubEnv('COOKIE_SECURE', undefined);

        controller = await createModule();
        mockResponse = createMockResponse();
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      describe('register', () => {
        it('sets refreshToken cookie with correct options', async () => {
          mockAuthService.register.mockResolvedValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          });

          await controller.register({ email: 'test@example.com', password: 'password123' }, mockResponse as Response);

          const cookies = mockResponse.getCookies();
          expect(cookies.refreshToken).toBeDefined();
          expect(cookies.refreshToken.options).toMatchObject({
            httpOnly: true,
            secure: expectedSecure,
            sameSite: 'lax',
            path: '/api/v1/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          expect(cookies.refreshToken.value).toBe('refresh-token');
        });

        it('sets csrfToken cookie with correct options', async () => {
          mockAuthService.register.mockResolvedValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          });

          await controller.register({ email: 'test@example.com', password: 'password123' }, mockResponse as Response);

          const cookies = mockResponse.getCookies();
          expect(cookies.csrfToken).toBeDefined();
          expect(cookies.csrfToken.options).toMatchObject({
            httpOnly: false,
            secure: expectedSecure,
            sameSite: 'lax',
            path: '/',
          });
        });
      });

      describe('login', () => {
        it('sets refreshToken cookie with correct options', async () => {
          mockAuthService.login.mockResolvedValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          });

          await controller.login({ email: 'test@example.com', password: 'password123' }, mockResponse as Response);

          const cookies = mockResponse.getCookies();
          expect(cookies.refreshToken.options).toMatchObject({
            httpOnly: true,
            secure: expectedSecure,
            sameSite: 'lax',
            path: '/api/v1/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
        });
      });

      describe('refresh', () => {
        it('sets refreshToken cookie with correct options', async () => {
          mockAuthService.refresh.mockResolvedValue({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          });

          await controller.refresh(mockReq({ refreshToken: 'old-refresh-token' }), mockResponse as Response);

          const cookies = mockResponse.getCookies();
          expect(cookies.refreshToken.options).toMatchObject({
            httpOnly: true,
            secure: expectedSecure,
            sameSite: 'lax',
            path: '/api/v1/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          expect(cookies.refreshToken.value).toBe('new-refresh-token');
        });

        it('throws UnauthorizedException when no refresh token cookie', async () => {
          await expect(controller.refresh(mockReq({}), mockResponse as Response)).rejects.toThrow(UnauthorizedException);
        });
      });

      describe('logout', () => {
        it('clears refreshToken cookie with matching options including secure flag', async () => {
          mockAuthService.revokeTokenFamily.mockResolvedValue(undefined);

          await controller.logout(mockReq({ refreshToken: 'some-token' }), mockResponse as Response);

          const cleared = mockResponse.getClearedCookies();
          expect(cleared.refreshToken).toMatchObject({
            path: '/api/v1/auth',
            secure: expectedSecure,
            httpOnly: true,
            sameSite: 'lax',
          });
          expect(cleared.csrfToken).toMatchObject({
            path: '/',
            secure: expectedSecure,
            httpOnly: false,
            sameSite: 'lax',
          });
          expect(mockAuthService.revokeTokenFamily).toHaveBeenCalledWith('some-token');
        });

        it('clears cookies even when no refresh token present', async () => {
          mockAuthService.revokeTokenFamily.mockResolvedValue(undefined);

          await controller.logout(mockReq({}), mockResponse as Response);

          const cleared = mockResponse.getClearedCookies();
          expect(cleared.refreshToken).toMatchObject({
            path: '/api/v1/auth',
            secure: expectedSecure,
          });
          expect(cleared.csrfToken).toMatchObject({
            path: '/',
            secure: expectedSecure,
          });
          expect(mockAuthService.revokeTokenFamily).not.toHaveBeenCalled();
        });

        it('returns ok true', async () => {
          mockAuthService.revokeTokenFamily.mockResolvedValue(undefined);

          const result = await controller.logout(mockReq({ refreshToken: 'token' }), mockResponse as Response);

          expect(result).toEqual({ ok: true });
        });
      });
    });
  };

  runTests('development', false);
  runTests('production', true);

  describe('COOKIE_SECURE explicit override', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('COOKIE_SECURE', 'true');

      controller = await createModule();
      mockResponse = createMockResponse();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses COOKIE_SECURE=true even in development', async () => {
      mockAuthService.register.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      await controller.register({ email: 'test@example.com', password: 'password123' }, mockResponse as Response);

      const cookies = mockResponse.getCookies();
      expect(cookies.refreshToken.options.secure).toBe(true);
      expect(cookies.csrfToken.options.secure).toBe(true);
    });
  });
});