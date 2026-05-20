import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

interface ValidatedUser {
  id: string;
  email: string;
  name: string | null;
  companyId: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<ValidatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      companyId: user.companyId,
      role: user.role,
    };
  }

  async login(loginDto: LoginDto): Promise<{
    access_token: string;
    user: ValidatedUser;
  }> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    const payload = {
      email: user.email,
      sub: user.id,
      userId: user.id,
      companyId: user.companyId,
      name: user.name,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyId: user.companyId,
        role: user.role,
      },
    };
  }
}
