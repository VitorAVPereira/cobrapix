import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottleGuard } from './throttle.guard';

interface TestRequest {
  method?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  body?: unknown;
  user?: unknown;
  socket: {
    remoteAddress?: string;
  };
}

class TestResponse {
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

describe('ThrottleGuard', () => {
  const buildGuard = (): ThrottleGuard => {
    const configService: Pick<ConfigService, 'get'> = {
      get: <T = unknown>(key: string): T | undefined => {
        if (key === 'NODE_ENV') return 'test' as T;
        return undefined;
      },
    };

    return new ThrottleGuard(configService as ConfigService);
  };

  const buildContext = (
    request: TestRequest,
    response = new TestResponse(),
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: <T>(): T => request as unknown as T,
        getResponse: <T>(): T => response as unknown as T,
      }),
    }) as unknown as ExecutionContext;

  const buildLoginRequest = (email: string): TestRequest => ({
    method: 'POST',
    path: '/auth/login',
    ip: '203.0.113.10',
    body: { email },
    socket: {},
  });

  it('permite a primeira tentativa mesmo quando o Redis nao esta conectado', async () => {
    const guard = buildGuard();
    const context = buildContext(buildLoginRequest('admin@cobrapix.com'));

    await expect(guard.canActivate(context)).resolves.toBe(true);

    guard.onModuleDestroy();
  });

  it('bloqueia tentativas repetidas do mesmo e-mail e IP', async () => {
    const guard = buildGuard();
    const response = new TestResponse();

    for (let attempt = 0; attempt < 10; attempt++) {
      const context = buildContext(
        buildLoginRequest('admin@cobrapix.com'),
        response,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const blockedContext = buildContext(
      buildLoginRequest('admin@cobrapix.com'),
      response,
    );

    try {
      await guard.canActivate(blockedContext);
      throw new Error('Expected request to be rate limited.');
    } catch (error: unknown) {
      if (!(error instanceof HttpException)) throw error;
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(response.headers.get('Retry-After')).toBeDefined();

    guard.onModuleDestroy();
  });

  it('nao pune usuarios diferentes na mesma rede antes do limite amplo por IP', async () => {
    const guard = buildGuard();

    for (let attempt = 0; attempt < 12; attempt++) {
      const context = buildContext(
        buildLoginRequest(`usuario-${attempt}@cobrapix.com`),
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    guard.onModuleDestroy();
  });

  it('ignora rotas sem regra de rate limiting', async () => {
    const guard = buildGuard();
    const context = buildContext({
      method: 'GET',
      path: '/health',
      ip: '203.0.113.10',
      socket: {},
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    guard.onModuleDestroy();
  });
});
