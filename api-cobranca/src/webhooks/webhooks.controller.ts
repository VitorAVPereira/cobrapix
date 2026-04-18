import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
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
}
