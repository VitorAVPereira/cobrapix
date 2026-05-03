import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

@Injectable()
export class EfiWebhookGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedSecret =
      this.configService.getOrThrow<string>('EFI_WEBHOOK_SECRET');
    const providedSecret = this.extractProvidedSecret(request);

    if (
      !providedSecret ||
      !this.secureCompare(providedSecret, expectedSecret)
    ) {
      throw new UnauthorizedException('Nao autorizado');
    }

    return true;
  }

  private extractProvidedSecret(request: Request): string | undefined {
    const headerSecret = request.header('x-api-key');
    if (headerSecret) {
      return headerSecret;
    }

    const querySecret = request.query.token;
    if (typeof querySecret === 'string') {
      return querySecret;
    }

    if (Array.isArray(querySecret) && typeof querySecret[0] === 'string') {
      return querySecret[0];
    }

    return undefined;
  }

  private secureCompare(received: string, expected: string): boolean {
    const receivedHash = createHash('sha256').update(received).digest();
    const expectedHash = createHash('sha256').update(expected).digest();

    return timingSafeEqual(receivedHash, expectedHash);
  }
}
