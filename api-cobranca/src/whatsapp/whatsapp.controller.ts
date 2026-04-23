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
  @Post('instance')
  async createInstance(@GetUser() user: any) {
    try {
      const instanceName = `cobrapix_${user.companyId}`;

      // 1. Dispara a ordem de criação da instância
      const createRes: any =
        await this.whatsappService.createInstance(instanceName);

      // Atualiza empresa no banco
      await this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          whatsappInstanceId: instanceName,
          whatsappStatus: 'PENDING',
        },
      });

      // 🚨 A MÁGICA AQUI: Espera 2 segundos para o motor do WhatsApp (Baileys) dar boot
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 2. Pede o status da conexão e o QR Code gerado
      const qrResponse: any =
        await this.whatsappService.connectInstance(instanceName);

      // 🚨 FALLBACK TRIPLO: Procura o Base64 em todas as ramificações possíveis da V2
      const base64Code =
        qrResponse?.qrcode?.base64 ||
        qrResponse?.base64 ||
        createRes?.qrcode?.base64 ||
        createRes?.base64;

      if (!base64Code) {
        // Se a instância já estiver aberta (conectada), o QR Code vem nulo propositalmente
        if (qrResponse?.instance?.state === 'open') {
          throw new HttpException(
            'WhatsApp já está conectado!',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Log salva-vidas: Se falhar de novo, isso vai aparecer no seu terminal do NestJS
        console.error(
          '[Evolution API] Resposta sem QR Code:',
          JSON.stringify(qrResponse),
        );

        throw new HttpException(
          'O motor do WhatsApp está aquecendo. Clique em Tentar Novamente.',
          HttpStatus.ACCEPTED,
        );
      }

      // Limpa o prefixo do Data URI para o React renderizar perfeito
      const cleanQrCode = base64Code.replace(/^data:image\/[a-z]+;base64,/, '');

      return {
        qrCode: cleanQrCode,
        instanceName,
        pairingCode: qrResponse?.pairingCode || createRes?.qrcode?.pairingCode,
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Erro ao criar instância WhatsApp',
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.BAD_GATEWAY,
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

      // 🚨 ESCUDO 1: A Fonte da Verdade! Se o nosso Webhook já atualizou o banco, libera a tela do usuário na hora.
      if (company.whatsappStatus === 'CONNECTED') {
        return { state: 'open', dbStatus: 'CONNECTED' };
      }

      try {
        // 🚨 ESCUDO 2: Se o banco ainda não sabe, pergunta direto para a Evolution API
        const result: any = await this.whatsappService.getConnectionState(
          company.whatsappInstanceId,
        );

        // Extrai o status de forma robusta, suportando os vários formatos da V2
        const rawState =
          result?.instance?.state || result?.state || 'connecting';
        const state = rawState.toLowerCase();

        // Se a Evolution confirmar a conexão, salva no banco e avisa o React
        if (state === 'open' || state === 'connected') {
          await this.prisma.company.update({
            where: { id: user.companyId },
            data: { whatsappStatus: 'CONNECTED' },
          });
          return { state: 'open', dbStatus: 'CONNECTED' };
        }

        return { state, dbStatus: company.whatsappStatus };
      } catch (evoError) {
        // 🚨 ESCUDO 3: Se a Evolution demorar para responder (Timeout), não quebramos a API com Erro 502.
        // Apenas mandamos a tela "esperar" até a próxima tentativa de 3 segundos.
        return { state: 'connecting', dbStatus: company.whatsappStatus };
      }
    } catch (error) {
      throw new HttpException(
        'Erro interno ao consultar status',
        HttpStatus.INTERNAL_SERVER_ERROR,
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
