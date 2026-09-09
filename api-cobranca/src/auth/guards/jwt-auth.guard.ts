import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../decorators/allow-password-change-required.decorator';
import { AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = AuthenticatedUser>(
    error: unknown,
    user: unknown,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const resolvedUser = super.handleRequest<unknown>(
      error,
      user,
      info,
      context,
      status,
    );
    if (!this.isAuthenticatedUser(resolvedUser)) {
      throw new UnauthorizedException();
    }

    const allowPasswordChangeRequired =
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? false;

    if (resolvedUser.mustChangePassword && !allowPasswordChangeRequired) {
      throw new ForbiddenException(
        'Troque a senha temporária antes de continuar.',
      );
    }

    return resolvedUser as unknown as TUser;
  }

  private isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.userId === 'string' &&
      typeof candidate.email === 'string' &&
      typeof candidate.companyId === 'string' &&
      typeof candidate.mustChangePassword === 'boolean' &&
      typeof candidate.tokenVersion === 'number'
    );
  }
}
