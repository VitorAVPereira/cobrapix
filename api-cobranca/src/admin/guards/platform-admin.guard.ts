import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/auth.types';

interface RequestWithUser {
  user?: Partial<AuthenticatedUser>;
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (request.user?.role === UserRole.PLATFORM_ADMIN) {
      return true;
    }

    throw new ForbiddenException('Acesso restrito ao admin da plataforma.');
  }
}
