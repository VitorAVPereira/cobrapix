import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
@Injectable()
export class CardCheckoutGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    const frontend = this.config.get<string>('FRONTEND_URL');
    let expected: string;
    try {
      expected = new URL(frontend ?? '').origin;
    } catch {
      throw new ForbiddenException('Origem do pagamento indisponível.');
    }
    if (request.headers.origin !== expected)
      throw new ForbiddenException('Origem do pagamento inválida.');
    return true;
  }
}
