import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('evolution')
  async handleEvolutionWebhook(@Body() payload: unknown) {
    try {
      const result = await this.webhooksService.handleEvolutionWebhook(payload);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Nao autorizado') {
        throw new HttpException('Nao autorizado', HttpStatus.UNAUTHORIZED);
      }
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('efi/pix')
  async handleEfiPixWebhook(@Body() payload: unknown) {
    try {
      return await this.webhooksService.handleEfiPixWebhook(payload);
    } catch (error) {
      this.logger.error(
        'Erro ao processar webhook Efi Pix:',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('efi/cobrancas')
  async handleEfiChargesWebhook(@Body() payload: unknown) {
    try {
      return await this.webhooksService.handleEfiChargesWebhook(payload);
    } catch (error) {
      this.logger.error(
        'Erro ao processar webhook Efi Cobrancas:',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
