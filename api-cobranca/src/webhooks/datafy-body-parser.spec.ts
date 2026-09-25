import { Body, Controller, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { json } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { datafyBodyParser } from './datafy-body-parser';

@Controller()
class EchoController {
  @Post('auth/login')
  login(@Body() body: unknown): unknown {
    return body;
  }

  @Post('webhooks/datafy')
  datafy(@Req() req: RawBodyRequest<Request>): unknown {
    return { raw: req.rawBody?.toString('utf8') ?? null };
  }
}

async function bootstrap(parser: ReturnType<typeof datafyBodyParser>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [EchoController],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  // Same order as src/main.ts: route parser before init.
  app.use('/webhooks/datafy', parser);
  await app.init();
  return app;
}

describe('datafyBodyParser', () => {
  it('keeps the global JSON parser for every other route', async () => {
    const app = await bootstrap(datafyBodyParser());
    try {
      const server = app.getHttpServer() as Server;
      await request(server)
        .post('/auth/login')
        .send({ email: 'a@example.test' })
        .expect(201, { email: 'a@example.test' });
      const raw = '{"object":"whatsapp_business_account"}';
      await request(server)
        .post('/webhooks/datafy')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(201, { raw });
    } finally {
      await app.close();
    }
  });

  it('documents the failure it prevents: a middleware named jsonParser disables Nest parsing', async () => {
    const app = await bootstrap(json());
    try {
      await request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({ email: 'a@example.test' })
        .expect(201, {});
    } finally {
      await app.close();
    }
  });
});
