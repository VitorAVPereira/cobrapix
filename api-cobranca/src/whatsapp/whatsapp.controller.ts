import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('instance')
  async createInstance(@GetUser() user: AuthenticatedUser) {
    try {
      const instanceName = `cobrapix_${user.companyId}`;

      const createResult =
        await this.whatsappService.createInstance(instanceName);

      await this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          whatsappInstanceId: instanceName,
          whatsappStatus: 'PENDING',
        },
      });

      await this.waitForEvolutionBoot();

      const connectResult =
        await this.whatsappService.connectInstance(instanceName);

      if (connectResult.state === 'open' || createResult.state === 'open') {
        await this.prisma.company.update({
          where: { id: user.companyId },
          data: { whatsappStatus: 'CONNECTED' },
        });

        return {
          qrCode: null,
          instanceName,
          pairingCode: connectResult.pairingCode ?? createResult.pairingCode,
          state: 'open' as const,
          dbStatus: 'CONNECTED' as const,
        };
      }

      const qrCode = connectResult.qrCode ?? createResult.qrCode;

      if (!qrCode) {
        this.logger.warn(
          `[Evolution API] Instância ${instanceName} ainda sem QR code disponível`,
        );
        throw new HttpException(
          'O motor do WhatsApp ainda está iniciando. Tente novamente em alguns segundos.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      return {
        qrCode,
        instanceName,
        pairingCode: connectResult.pairingCode ?? createResult.pairingCode,
        state: 'connecting' as const,
        dbStatus: 'PENDING' as const,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Erro ao criar instância do WhatsApp',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('status')
  async getStatus(@GetUser() user: AuthenticatedUser) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { whatsappInstanceId: true, whatsappStatus: true },
      });

      if (!company?.whatsappInstanceId) {
        return {
          state: 'close' as const,
          dbStatus: company?.whatsappStatus ?? 'DISCONNECTED',
        };
      }

      if (company.whatsappStatus === 'CONNECTED') {
        return { state: 'open' as const, dbStatus: 'CONNECTED' as const };
      }

      try {
        const result = await this.whatsappService.getConnectionState(
          company.whatsappInstanceId,
        );

        if (result.state === 'open') {
          await this.prisma.company.update({
            where: { id: user.companyId },
            data: { whatsappStatus: 'CONNECTED' },
          });

          return { state: 'open' as const, dbStatus: 'CONNECTED' as const };
        }

        if (result.state === 'close') {
          await this.prisma.company.update({
            where: { id: user.companyId },
            data: { whatsappStatus: 'DISCONNECTED' },
          });

          return {
            state: 'close' as const,
            dbStatus: 'DISCONNECTED' as const,
          };
        }

        return {
          state: 'connecting' as const,
          dbStatus: company.whatsappStatus,
        };
      } catch (evolutionError) {
        this.logger.warn(
          `Falha ao consultar status da Evolution para ${company.whatsappInstanceId}: ${
            evolutionError instanceof Error
              ? evolutionError.message
              : 'erro desconhecido'
          }`,
        );

        const fallbackState =
          company.whatsappStatus === 'DISCONNECTED' ? 'close' : 'connecting';

        return {
          state: fallbackState,
          dbStatus: company.whatsappStatus,
        };
      }
    } catch {
      throw new HttpException(
        'Erro interno ao consultar status do WhatsApp.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('disconnect')
  async disconnect(@GetUser() user: AuthenticatedUser) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { whatsappInstanceId: true },
      });

      if (!company?.whatsappInstanceId) {
        throw new HttpException(
          'Nenhuma instância do WhatsApp está ativa.',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.whatsappService.logoutInstance(company.whatsappInstanceId);

      await this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          whatsappInstanceId: null,
          whatsappStatus: 'DISCONNECTED',
        },
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Erro ao desconectar WhatsApp.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async waitForEvolutionBoot(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
