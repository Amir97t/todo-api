import { Controller, Post, Get, Body, Req, Res, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service.js';
import { UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { CsrfGuard } from './csrf.guard.js';
import { AuthRateLimitGuard } from './throttler/auth-rate-limit.guard.js';
import {
  getRefreshTokenCookieOptions,
  getCsrfTokenCookieOptions,
  getRefreshTokenClearOptions,
  getCsrfTokenClearOptions,
} from './cookie.config.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('csrf')
  async getCsrfToken(@Res({ passthrough: true }) res: Response) {
    const token = randomBytes(32).toString('hex');
    res.cookie('csrfToken', token, getCsrfTokenCookieOptions());
    return { csrfToken: token };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @SkipThrottle({ 'login-ip': true, 'login-email': true, 'refresh-ip': true })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.register(dto.email, dto.password);

    res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

    res.cookie('csrfToken', randomBytes(32).toString('hex'), getCsrfTokenCookieOptions());

    return { accessToken };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @SkipThrottle({ 'register-ip': true, 'register-email': true, 'refresh-ip': true })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(dto.email, dto.password);

    res.cookie('refreshToken', refreshToken, getRefreshTokenCookieOptions());

    res.cookie('csrfToken', randomBytes(32).toString('hex'), getCsrfTokenCookieOptions());

    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @SkipThrottle({
    'login-ip': true,
    'login-email': true,
    'register-ip': true,
    'register-email': true,
  })
  async refresh(
    @Req() req: Request & { cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
      await this.authService.refresh(refreshToken);

    res.cookie('refreshToken', newRefreshToken, getRefreshTokenCookieOptions());

    res.cookie('csrfToken', randomBytes(32).toString('hex'), getCsrfTokenCookieOptions());

    return { accessToken: newAccessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async logout(
    @Req() req: Request & { cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await this.authService.revokeTokenFamily(refreshToken);
    }

    res.clearCookie('refreshToken', getRefreshTokenClearOptions());
    res.clearCookie('csrfToken', getCsrfTokenClearOptions());

    return { ok: true };
  }
}