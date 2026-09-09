import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Queue } from 'bullmq';
import { createHash, createHmac, randomUUID } from 'crypto';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { AuthenticatedUser, MessageResponse } from './auth.types';

const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.';
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const INVALID_RESET_TOKEN_MESSAGE =
  'O link de redefinição é inválido ou expirou. Solicite um novo link.';

interface ValidatedUser {
  id: string;
  email: string;
  name: string | null;
  companyId: string;
  role: UserRole;
  mustChangePassword: boolean;
  tokenVersion: number;
}

export interface PasswordRecoveryJob {
  email: string;
  requestId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly resendMailer: ResendMailerService,
    @InjectQueue('auth-password-recovery')
    private readonly passwordRecoveryQueue: Queue<PasswordRecoveryJob>,
  ) {}

  async validateUser(email: string, password: string): Promise<ValidatedUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
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
      mustChangePassword: user.mustChangePassword,
      tokenVersion: user.tokenVersion,
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
      mustChangePassword: user.mustChangePassword,
      tokenVersion: user.tokenVersion,
    };
    const access_token = this.jwtService.sign(payload, { expiresIn: '7d' });

    return { access_token, user };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<MessageResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    await this.passwordRecoveryQueue.add(
      'send-password-reset',
      { email: normalizedEmail, requestId: randomUUID() },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        deduplication: {
          id: this.hashToken(`password-recovery:${normalizedEmail}`),
        },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async processPasswordRecovery(
    email: string,
    requestId: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      select: { id: true, email: true, name: true, companyId: true },
    });

    if (!user) {
      return;
    }

    const secret = this.deriveResetSecret(requestId);
    const tokenHash = this.hashToken(secret);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.upsert({
        where: {
          companyId_tokenHash: {
            companyId: user.companyId,
            tokenHash,
          },
        },
        update: {},
        create: {
          companyId: user.companyId,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    await this.sendPasswordResetEmail({
      companyId: user.companyId,
      email: user.email,
      name: user.name,
      secret,
    });

    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.deleteMany({
        where: {
          companyId: user.companyId,
          userId: user.id,
          tokenHash: { not: tokenHash },
        },
      });
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponse> {
    this.assertMatchingPasswords(dto.password, dto.passwordConfirmation);
    const parsedToken = this.parsePublicResetToken(dto.token);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async (transaction) => {
      const resetToken = await transaction.passwordResetToken.findFirst({
        where: {
          companyId: parsedToken.companyId,
          tokenHash: parsedToken.tokenHash,
          usedAt: null,
        },
      });

      if (!resetToken || resetToken.expiresAt <= new Date()) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          companyId: parsedToken.companyId,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      const updated = await transaction.user.updateMany({
        where: { id: resetToken.userId, companyId: parsedToken.companyId },
        data: {
          password: passwordHash,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      await transaction.passwordResetToken.deleteMany({
        where: {
          companyId: parsedToken.companyId,
          userId: resetToken.userId,
        },
      });
    });

    return { message: 'Senha redefinida com sucesso.' };
  }

  async changePassword(
    authenticatedUser: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<MessageResponse> {
    this.assertMatchingPasswords(dto.password, dto.passwordConfirmation);
    const user = await this.prisma.user.findFirst({
      where: {
        id: authenticatedUser.userId,
        companyId: authenticatedUser.companyId,
      },
      select: { id: true, password: true },
    });

    if (!user || !(await bcrypt.compare(dto.currentPassword, user.password))) {
      throw new UnauthorizedException('A senha atual está incorreta.');
    }
    if (await bcrypt.compare(dto.password, user.password)) {
      throw new BadRequestException(
        'A nova senha deve ser diferente da senha atual.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: {
          id: user.id,
          companyId: authenticatedUser.companyId,
          tokenVersion: authenticatedUser.tokenVersion,
        },
        data: {
          password: passwordHash,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new UnauthorizedException('Não foi possível alterar a senha.');
      }

      await transaction.passwordResetToken.deleteMany({
        where: {
          companyId: authenticatedUser.companyId,
          userId: user.id,
        },
      });
    });

    return { message: 'Senha alterada com sucesso.' };
  }

  private assertMatchingPasswords(
    password: string,
    confirmation: string,
  ): void {
    if (password !== confirmation) {
      throw new BadRequestException('A confirmação da senha não confere.');
    }
  }

  private parsePublicResetToken(token: string): {
    companyId: string;
    tokenHash: string;
  } {
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const companyId = token.slice(0, separatorIndex);
    const secret = token.slice(separatorIndex + 1);
    return { companyId, tokenHash: this.hashToken(secret) };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private deriveResetSecret(requestId: string): string {
    const signingKey = this.configService.get<string>('JWT_SECRET');
    if (!signingKey) {
      throw new Error('JWT_SECRET não configurada para recuperação de senha.');
    }

    return createHmac('sha256', signingKey)
      .update(`password-reset:${requestId}`)
      .digest('base64url');
  }

  private async sendPasswordResetEmail(input: {
    companyId: string;
    email: string;
    name: string | null;
    secret: string;
  }): Promise<void> {
    const apiKey = this.configService.get<string>('AUTH_RESEND_API_KEY');
    const from = this.configService.get<string>('AUTH_EMAIL_FROM');
    if (!apiKey || !from) {
      this.logger.warn(
        'E-mail de recuperação não enviado: provedor de autenticação não configurado.',
      );
      return;
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const publicToken = `${input.companyId}.${input.secret}`;
    const resetUrl = `${frontendUrl}/redefinir-senha?token=${encodeURIComponent(publicToken)}`;
    const safeName = this.escapeHtml(input.name?.trim() || 'Olá');

    try {
      await this.resendMailer.sendEmail({
        apiKey,
        from,
        to: [input.email],
        subject: 'Redefinição de senha — CobraPix',
        html: `<p>${safeName},</p><p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${resetUrl}">Redefinir minha senha</a></p><p>Este link expira em 30 minutos e pode ser usado uma única vez.</p>`,
      });
    } catch (error: unknown) {
      this.logger.warn(
        'Falha ao enviar e-mail de recuperação pelo provedor configurado.',
      );
      throw error;
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
