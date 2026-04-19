import {
  Controller,
  Post,
  Get,
  UseGuards,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('instance')
  async createInstance(@GetUser() user: any) {
    try {
      const instanceName = `cobrapix_${user.companyId}`;

      // Cria instância na Evolution API
      await this.whatsappService.createInstance(instanceName);

      // Atualiza empresa no banco
      await this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          whatsappInstanceId: instanceName,
          whatsappStatus: 'PENDING',
        },
      });

      // Obtém QR code
      const qrResponse =
        await this.whatsappService.connectInstance(instanceName);

      if (!qrResponse.code) {
        throw new HttpException(
          'QR code ainda não foi gerado. Tente novamente em instantes.',
          HttpStatus.ACCEPTED,
        );
      }

      return {
        qrCode: qrResponse.code,
        instanceName,
        pairingCode: qrResponse.pairingCode,
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Erro ao criar instância WhatsApp',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('status')
  async getStatus(@GetUser() user: any) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { whatsappInstanceId: true, whatsappStatus: true },
      });

      if (!company?.whatsappInstanceId) {
        return {
          state: 'close',
          dbStatus: company?.whatsappStatus || 'DISCONNECTED',
        };
      }

      const result = await this.whatsappService.getConnectionState(
        company.whatsappInstanceId,
      );
      const state = result.instance.state;

      // Sincroniza estado no banco
      if (state === 'open' && company.whatsappStatus !== 'CONNECTED') {
        await this.prisma.company.update({
          where: { id: user.companyId },
          data: { whatsappStatus: 'CONNECTED' },
        });
      } else if (state === 'close' && company.whatsappStatus === 'CONNECTED') {
        await this.prisma.company.update({
          where: { id: user.companyId },
          data: { whatsappStatus: 'DISCONNECTED' },
        });
      }

      return {
        state,
        dbStatus: state === 'open' ? 'CONNECTED' : company.whatsappStatus,
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao consultar status',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('disconnect')
  async disconnect(@GetUser() user: any) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { whatsappInstanceId: true },
      });

      if (!company?.whatsappInstanceId) {
        throw new HttpException(
          'Nenhuma instância WhatsApp ativa.',
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
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao desconectar WhatsApp',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
