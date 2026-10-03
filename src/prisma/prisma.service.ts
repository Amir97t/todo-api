import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const databaseUrl = config.get<string>('DATABASE_URL');

    if (!databaseUrl) {
      throw new Error(
        [
          'DATABASE_URL is not set, so the database connection cannot be created.',
          'Copy .env.example to .env and set DATABASE_URL to a PostgreSQL connection string,',
          'for example:',
          '  DATABASE_URL="postgresql://user:password@localhost:5432/todo_dev?schema=public"',
        ].join('\n'),
      );
    }

    super({ adapter: new PrismaPg(databaseUrl) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      this.logger.error(
        `PostgreSQL is not reachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
