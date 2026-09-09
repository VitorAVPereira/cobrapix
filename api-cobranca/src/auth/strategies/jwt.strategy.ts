import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, companyId: payload.companyId },
      select: {
        id: true,
        email: true,
        name: true,
        companyId: true,
        role: true,
        mustChangePassword: true,
        tokenVersion: true,
      },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      companyId: user.companyId,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      tokenVersion: user.tokenVersion,
    };
  }
}
