import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Internal signal: this request lost the atomic consume race to a concurrent
 * refresh of the same token. Escapes the transaction (which rolls back) so
 * the family can be revoked outside it — revoking inside a transaction that
 * then throws would roll the revocation back with everything else.
 */
class RefreshTokenRaceError extends Error {
  constructor() {
    super('Refresh token consume race lost');
    this.name = 'RefreshTokenRaceError';
  }
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateAccessToken(userId: string): string {
    return this.jwtService.sign({ sub: userId });
  }

  async register(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new UnauthorizedException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { user, refreshToken } = await this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash },
        });

        // The user's personal Inbox, created atomically with the user row so
        // no registered user can exist without one. userId scoping and the
        // List_userId_inbox_key partial unique index keep it single and unique
        // per user at the database level.
        await tx.list.create({
          data: {
            name: 'Inbox',
            icon: 'inbox',
            isInbox: true,
            userId: user.id,
          },
        });

        const { token } = await this.createRefreshToken(user.id, tx);
        return { user, refreshToken: token };
      })
      .catch((error: unknown) => {
        // Two concurrent registrations of the same email can both pass the
        // pre-check above; the database's email unique index is the final
        // arbiter and the loser maps to the same 401 as a sequential dup.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new UnauthorizedException('Email already registered');
        }
        throw error;
      });

    const accessToken = this.generateAccessToken(user.id);

    return { accessToken, refreshToken };
  }

  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { token: refreshToken } = await this.createRefreshToken(user.id);
    const accessToken = this.generateAccessToken(user.id);

    return { accessToken, refreshToken };
  }

  async createRefreshToken(
    userId: string,
    client: Pick<PrismaService, 'refreshToken'> = this.prisma,
  ): Promise<{ token: string; hash: string }> {
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    await client.refreshToken.create({
      data: {
        tokenHash: hash,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { token, hash };
  }

  async validateRefreshToken(tokenHash: string, userId: string | null) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException();
    }
    if (userId !== null && record.userId !== userId) {
      throw new UnauthorizedException();
    }
    return record;
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record) {
      throw new UnauthorizedException();
    }
    if (record.revokedAt) {
      // Replay of an already-consumed token: theft/reuse signal. Revoke the
      // whole family (including any descendant a concurrent legit rotation
      // already issued) before rejecting. Natural expiry below is NOT treated
      // as replay and does not revoke the family.
      await this.revokeTokenFamilyById(record.id);
      throw new UnauthorizedException();
    }
    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Atomic consume: only one concurrent refresh can flip revokedAt
        // from null; the loser observes count === 0 and is treated as reuse.
        const updated = await tx.refreshToken.updateMany({
          where: {
            id: record.id,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });

        if (updated.count === 0) {
          throw new RefreshTokenRaceError();
        }

        const newRefreshToken = randomBytes(32).toString('hex');
        const newHash = createHash('sha256').update(newRefreshToken).digest('hex');
        await tx.refreshToken.create({
          data: {
            tokenHash: newHash,
            userId: record.userId,
            parentId: record.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        const accessToken = this.generateAccessToken(record.userId);
        return { accessToken, refreshToken: newRefreshToken };
      });
    } catch (err) {
      if (err instanceof RefreshTokenRaceError) {
        // The transaction rolled back; revoke the family (the presented token
        // plus the winner's newly issued descendant) outside it so the
        // revocation persists.
        await this.revokeTokenFamilyById(record.id);
        throw new UnauthorizedException();
      }
      throw err;
    }
  }

  async revokeTokenFamily(token: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record) return;

    await this.revokeTokenFamilyById(record.id);
  }

  private async revokeTokenFamilyById(startId: string): Promise<void> {
    const familyIds = await this.collectFamilyIds(startId);

    await this.prisma.refreshToken.updateMany({
      where: { id: { in: familyIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async collectFamilyIds(startId: string): Promise<string[]> {
    const allIds: string[] = [];
    const toVisit: string[] = [startId];
    const visited = new Set<string>();

    while (toVisit.length > 0) {
      const currentId = toVisit.pop()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      allIds.push(currentId);

      const current = await this.prisma.refreshToken.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      if (current?.parentId && !visited.has(current.parentId)) {
        toVisit.push(current.parentId);
      }

      const children = await this.prisma.refreshToken.findMany({
        where: { parentId: currentId },
        select: { id: true },
      });
      for (const child of children) {
        if (!visited.has(child.id)) {
          toVisit.push(child.id);
        }
      }
    }

    return allIds;
  }

  async revokeAllUserTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}