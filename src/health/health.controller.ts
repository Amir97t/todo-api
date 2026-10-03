import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type DatabaseStatus = 'up' | 'down';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth() {
    const startedAt = Date.now();
    let database: DatabaseStatus = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: {
        status: database,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
