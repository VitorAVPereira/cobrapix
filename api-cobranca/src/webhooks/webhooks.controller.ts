import { Controller, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('evolution')
  async handleEvolutionWebhook(@Body() payload: any) {
    try {
      const result = await this.webhooksService.handleEvolutionWebhook(payload);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Não autorizado') {
        throw new HttpException('Não autorizado', HttpStatus.UNAUTHORIZED);
      }
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('asaas')
  async handleAsaasWebhook(@Body() payload: any) {
    try {
      const result = await this.webhooksService.handleAsaasWebhook(payload);
      return result;
    } catch (error) {
      this.logger.error('Erro ao processar webhook Asaas:', error);
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
