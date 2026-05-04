import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import type { Request, Response } from 'express';
import Redis from 'ioredis';

interface AuthenticatedUser {
  companyId: string;
}

interface ThrottleConfig {
  points: number;
  duration: number;
  keyPrefix: string;
  scope: 'ip' | 'company' | 'login';
}

type RateLimiter = RateLimiterMemory | RateLimiterRedis;

@Injectable()
export class ThrottleGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(ThrottleGuard.name);
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly redisClient?: Redis;
  private redisUnavailableLogged = false;

  private readonly configs: ThrottleConfig[] = [
    {
      points: 10,
      duration: 60,
      keyPrefix: 'throttle:auth:login:credential',
      scope: 'login',
    },
    {
      points: 60,
      duration: 60,
      keyPrefix: 'throttle:auth:login:ip',
      scope: 'ip',
    },
    {
      points: 100,
      duration: 60,
      keyPrefix: 'throttle:payments',
      scope: 'company',
    },
    {
      points: 200,
      duration: 60,
      keyPrefix: 'throttle:invoices',
      scope: 'company',
    },
    {
      points: 5,
      duration: 60,
      keyPrefix: 'throttle:whatsapp',
      scope: 'company',
    },
    {
      points: 10,
      duration: 300,
      keyPrefix: 'throttle:billing:run',
      scope: 'company',
    },
  ];

  constructor(private configService: ConfigService) {
    const redisHost =
      this.configService.get<string>('REDIS_HOST') ?? 'localhost';
    const redisPort = this.resolveRedisPort();
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    try {
      const redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1_000,
        retryStrategy: (times: number): number => Math.min(times * 250, 5_000),
      });

      this.redisClient = redisClient;
      this.registerRedisHandlers(redisClient);

      for (const config of this.configs) {
        this.limiters.set(
          config.keyPrefix,
          new RateLimiterRedis({
            storeClient: redisClient,
            points: config.points,
            duration: config.duration,
            keyPrefix: config.keyPrefix,
            rejectIfRedisNotReady: true,
            insuranceLimiter: this.createMemoryLimiter(config),
          }),
        );
      }

      if (this.configService.get<string>('NODE_ENV') !== 'test') {
        void this.connectRedis(redisClient);
      }
    } catch {
      this.logger.warn('Redis indisponivel — usando rate limiting em memoria.');
      this.useMemoryLimiters();
    }
  }

  onModuleDestroy(): void {
    this.redisClient?.disconnect();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const path: string = this.extractPath(request);
    const method: string = (request.method ?? 'GET').toUpperCase();

    const configs = this.resolveConfigs(method, path);
    if (configs.length === 0) return true;

    for (const config of configs) {
      await this.consume(config, request, response);
    }

    return true;
  }

  private async consume(
    config: ThrottleConfig,
    request: Request,
    response: Response,
  ): Promise<void> {
    const limiter = this.limiters.get(config.keyPrefix);
    if (!limiter) return;

    const key = this.resolveKey(config, request);

    try {
      const result = await limiter.consume(key);

      if (result.remainingPoints <= 1) {
        this.logger.warn(
          `Rate limit proximo em ${config.keyPrefix} para ${key}: ${result.remainingPoints} restantes`,
        );
      }

      if (result.remainingPoints === 0) {
        const retryAfter = Math.ceil(result.msBeforeNext / 1000);
        response.setHeader('Retry-After', String(retryAfter));
      }
    } catch (error: unknown) {
      if (!this.isRateLimitExceeded(error)) {
        this.logger.error(
          `Falha no rate limiter ${config.keyPrefix}; liberando requisicao para evitar falso positivo.`,
          this.formatError(error),
        );
        return;
      }

      const retryAfter = this.resolveRetryAfter(error);
      response.setHeader('Retry-After', String(retryAfter));

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Muitas requisicoes. Tente novamente em instantes.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private resolveConfigs(method: string, path: string): ThrottleConfig[] {
    if (method === 'POST' && path === '/auth/login') {
      return this.findConfigs([
        'throttle:auth:login:credential',
        'throttle:auth:login:ip',
      ]);
    }

    if (path.startsWith('/payments')) {
      return this.findConfigs(['throttle:payments']);
    }

    if (method === 'GET' && path === '/invoices') {
      return this.findConfigs(['throttle:invoices']);
    }

    if (method === 'POST' && path === '/whatsapp/meta') {
      return this.findConfigs(['throttle:whatsapp']);
    }

    if (method === 'POST' && path === '/billing/run') {
      return this.findConfigs(['throttle:billing:run']);
    }

    return [];
  }

  private resolveKey(config: ThrottleConfig, request: Request): string {
    if (config.scope === 'company') {
      const user = request.user as AuthenticatedUser | undefined;
      return user?.companyId ?? this.resolveClientIp(request);
    }

    if (config.scope === 'login') {
      return `${this.resolveClientIp(request)}:${this.resolveLoginIdentifier(request)}`;
    }

    return this.resolveClientIp(request);
  }

  private createMemoryLimiter(config: ThrottleConfig): RateLimiterMemory {
    return new RateLimiterMemory({
      points: config.points,
      duration: config.duration,
      keyPrefix: config.keyPrefix,
    });
  }

  private useMemoryLimiters(): void {
    for (const config of this.configs) {
      this.limiters.set(config.keyPrefix, this.createMemoryLimiter(config));
    }
  }

  private resolveRedisPort(): number {
    const value = this.configService.get<string | number>('REDIS_PORT') ?? 6379;
    const port = Number(value);

    if (Number.isInteger(port) && port > 0) {
      return port;
    }

    return 6379;
  }

  private registerRedisHandlers(redisClient: Redis): void {
    redisClient.on('ready', () => {
      this.redisUnavailableLogged = false;
      this.logger.log('Redis conectado para rate limiting.');
    });

    redisClient.on('error', (error: Error) => {
      this.logRedisUnavailable(error);
    });
  }

  private async connectRedis(redisClient: Redis): Promise<void> {
    try {
      await redisClient.connect();
    } catch (error: unknown) {
      this.logRedisUnavailable(error);
    }
  }

  private logRedisUnavailable(error: unknown): void {
    if (this.redisUnavailableLogged) return;

    this.redisUnavailableLogged = true;
    this.logger.warn(
      `Redis indisponivel para rate limiting; usando fallback em memoria. ${this.formatError(error)}`,
    );
  }

  private isRateLimitExceeded(error: unknown): error is RateLimiterRes {
    return error instanceof RateLimiterRes;
  }

  private resolveRetryAfter(error: RateLimiterRes): number {
    return Math.max(1, Math.ceil(error.msBeforeNext / 1000));
  }

  private findConfigs(prefixes: string[]): ThrottleConfig[] {
    return prefixes
      .map((prefix) =>
        this.configs.find((config) => config.keyPrefix === prefix),
      )
      .filter((config): config is ThrottleConfig => Boolean(config));
  }

  private extractPath(request: Request): string {
    const path = request.path ?? request.originalUrl ?? request.url ?? '';
    const [pathWithoutQuery] = path.split('?');
    const normalizedPath = pathWithoutQuery || '/';

    if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      return normalizedPath.slice(0, -1);
    }

    return normalizedPath;
  }

  private resolveClientIp(request: Request): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown';
  }

  private resolveLoginIdentifier(request: Request): string {
    const body = request.body as { email?: unknown } | undefined;
    const email = body?.email;

    if (typeof email !== 'string') {
      return 'missing-email';
    }

    const normalizedEmail = email.trim().toLowerCase();
    return normalizedEmail.length > 0 ? normalizedEmail : 'missing-email';
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Erro desconhecido.';
  }
}
