import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';
import * as bcrypt from 'bcrypt';

vi.mock('bcrypt');
vi.mock('crypto', () => {
  const mockBuffer = Buffer.from('deadbeef'.repeat(8), 'hex');
  return {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('mocked-hash'),
    })),
    randomBytes: vi.fn(() => mockBuffer),
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    list: {
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const mockJwtService = {
    sign: vi.fn().mockReturnValue('mock-access-token'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Family-walk children lookup defaults to "no children"; tests that model
    // a family override this with mockResolvedValueOnce sequences.
    mockPrisma.refreshToken.findMany.mockResolvedValue([]);
    prisma = mockPrisma as unknown as PrismaService;
    jwtService = mockJwtService as unknown as JwtService;
    service = new AuthService(prisma, jwtService);
  });

  describe('register', () => {
    it('creates user, personal Inbox, and returns tokens atomically', async () => {
      (bcrypt.hash as vi.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });
      mockPrisma.list.create.mockResolvedValue({ id: 'list-1' });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'token-1' });
      mockPrisma.$transaction.mockImplementation(async (cb) =>
        cb({
          user: mockPrisma.user,
          list: mockPrisma.list,
          refreshToken: mockPrisma.refreshToken,
        }),
      );

      const result = await service.register('test@example.com', 'password123');

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
      });
      expect(result.refreshToken).toHaveLength(64);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { email: 'test@example.com', passwordHash: 'hashed-password' },
      });
      expect(mockPrisma.list.create).toHaveBeenCalledWith({
        data: {
          name: 'Inbox',
          icon: 'inbox',
          isInbox: true,
          userId: 'user-1',
        },
      });
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('throws if email already registered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.register('test@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a concurrent duplicate-email unique violation to the same 401', async () => {
      (bcrypt.hash as vi.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register('test@example.com', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      (bcrypt.compare as vi.Mock).mockResolvedValue(true);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'token-1' });

      const result = await service.login('test@example.com', 'password123');

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
      });
      expect(result.refreshToken).toHaveLength(64);
    });

    it('throws for invalid user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('test@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
    });

    it('throws for invalid password', async () => {
      (bcrypt.compare as vi.Mock).mockResolvedValue(false);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });

      await expect(service.login('test@example.com', 'password123')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh rotation', () => {
    it('rotates token successfully', async () => {
      const oldRecord = { id: 'token-1', userId: 'user-1', revokedAt: null, expiresAt: new Date('2099-01-01') };
      mockPrisma.refreshToken.findUnique.mockResolvedValue(oldRecord);
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          refreshToken: {
            findUnique: vi.fn().mockResolvedValue(oldRecord),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({ id: 'token-2' }),
          },
        };
        return cb(tx);
      });

      const result = await service.refresh('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
      });
      expect(result.refreshToken).toHaveLength(64);
    });

    it('throws and revokes the family when reusing a revoked token', async () => {
      const revokedRecord = {
        id: 'token-1',
        userId: 'user-1',
        parentId: null,
        revokedAt: new Date(),
        expiresAt: new Date('2099-01-01'),
      };
      mockPrisma.refreshToken.findUnique.mockResolvedValue(revokedRecord);

      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);

      // Replay of a consumed token is a theft signal: the whole family is
      // revoked (here: the single presented token).
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['token-1'] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('throws without revoking the family when the token has naturally expired', async () => {
      const expiredRecord = {
        id: 'token-1',
        userId: 'user-1',
        parentId: null,
        revokedAt: null,
        expiresAt: new Date('2020-01-01'),
      };
      mockPrisma.refreshToken.findUnique.mockResolvedValue(expiredRecord);

      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);

      // Natural expiry is not reuse: no family revocation, no transaction.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('fails second concurrent refresh attempt and revokes the family', async () => {
      const record = {
        id: 'token-1',
        userId: 'user-1',
        parentId: null,
        revokedAt: null,
        expiresAt: new Date('2099-01-01'),
      };
      mockPrisma.refreshToken.findUnique.mockResolvedValue(record);

      let firstCall = true;
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          refreshToken: {
            findUnique: vi.fn().mockResolvedValue(record),
            updateMany: vi.fn().mockResolvedValue({ count: firstCall ? 1 : 0 }),
            create: vi.fn().mockResolvedValue({ id: 'token-2' }),
          },
        };
        firstCall = false;
        return cb(tx);
      });

      const firstResult = await service.refresh('valid-token');
      expect(firstResult.accessToken).toBe('mock-access-token');

      // The loser of the atomic consume race is treated as reuse: the family
      // (presented token + the winner's new descendant) is revoked.
      await expect(service.refresh('valid-token')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['token-1'] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeTokenFamily', () => {
    it('revokes three-generation linear family', async () => {
      const gen1 = { id: 'gen1', parentId: null };
      const gen2 = { id: 'gen2', parentId: 'gen1' };
      const gen3 = { id: 'gen3', parentId: 'gen2' };

      mockPrisma.refreshToken.findUnique
        .mockResolvedValueOnce(gen3)
        .mockResolvedValueOnce(gen2)
        .mockResolvedValueOnce(gen1)
        .mockResolvedValueOnce(null);

      mockPrisma.refreshToken.findMany
        .mockResolvedValueOnce([{ id: 'gen2' }])
        .mockResolvedValueOnce([{ id: 'gen3' }])
        .mockResolvedValueOnce([]);

      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeTokenFamily('token-gen3');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['gen3', 'gen2', 'gen1'] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes family with multiple branches', async () => {
      const root = { id: 'root', parentId: null };
      const childA = { id: 'childA', parentId: 'root' };
      const _childB = { id: 'childB', parentId: 'root' };
      const grandchildA = { id: 'grandchildA', parentId: 'childA' };

      mockPrisma.refreshToken.findUnique
        .mockResolvedValueOnce(grandchildA)
        .mockResolvedValueOnce(childA)
        .mockResolvedValueOnce(root)
        .mockResolvedValueOnce(null);

      mockPrisma.refreshToken.findMany
        .mockResolvedValueOnce([{ id: 'childA' }, { id: 'childB' }])
        .mockResolvedValueOnce([{ id: 'grandchildA' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 4 });

      await service.revokeTokenFamily('token-grandchildA');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: expect.arrayContaining(['root', 'childA', 'childB', 'grandchildA']) },
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('handles missing token gracefully', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.revokeTokenFamily('unknown-token')).resolves.not.toThrow();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('missing PrismaService wiring', () => {
    it('throws when PrismaService methods are called without PrismaService', async () => {
      const serviceWithoutPrisma = new AuthService(null as any, mockJwtService as any);
      await expect(serviceWithoutPrisma.register('test@example.com', 'password123')).rejects.toThrow();
    });
  });
});