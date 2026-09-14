import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TLSSocket } from 'tls';

@Injectable()
export class EfiMtlsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.socket instanceof TLSSocket && request.socket.authorized)
      return true;
    const trustedProxy = this.config.get<string>('EFI_MTLS_PROXY_IP');
    const remoteAddress = request.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (
      trustedProxy &&
      remoteAddress === trustedProxy &&
      request.headers['x-efi-client-verify'] === 'SUCCESS'
    )
      return true;
    throw new ForbiddenException('Certificado de cliente Efí obrigatório.');
  }
}
