import {
  Body,
  Controller,
  INestApplication,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Trim } from '../src/app/pipes/trim.decorator.js';

class DemoDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

@Controller('demo')
class DemoController {
  @Post()
  create(@Body() body: DemoDto) {
    return { name: body.name, completed: body.completed ?? null };
  }
}

describe('validation pipe (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [DemoController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer()).post('/api/v1/demo').send(body);

  it('accepts a valid body', async () => {
    const res = await post({ name: 'Work' }).expect(201);
    expect(res.body).toEqual({ name: 'Work', completed: null });
  });

  it('trims surrounding whitespace before validation and storage', async () => {
    const res = await post({ name: '   Shipping   ' }).expect(201);
    expect(res.body.name).toBe('Shipping');
  });

  it('rejects a name that is only whitespace', async () => {
    const res = await post({ name: '     ' }).expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(Array.isArray(res.body.message)).toBe(true);
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it('rejects a missing name', async () => {
    const res = await post({}).expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it('rejects unknown properties', async () => {
    const res = await post({ name: 'Work', bogus: 1 }).expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message.join(' ')).toContain('bogus');
  });

  it('rejects a non-boolean completed without implicit conversion', async () => {
    const res = await post({ name: 'Work', completed: 'yes' }).expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message.join(' ')).toContain('completed');
  });

  it('keeps every error body to the documented shape', async () => {
    const res = await post({ name: '' }).expect(400);

    expect(Object.keys(res.body).sort()).toEqual([
      'code',
      'error',
      'message',
      'statusCode',
    ]);
  });
});
