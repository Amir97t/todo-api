import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';

@Injectable()
export class CsrfService {
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  setCookie(res: Response, token: string) {
    res.cookie('csrfToken', token, {
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  }

  validate(req: Request): boolean {
    const cookieToken = req.cookies?.csrfToken;
    const headerToken = req.headers['x-csrf-token'];
    return cookieToken && headerToken && cookieToken === headerToken;
  }
}