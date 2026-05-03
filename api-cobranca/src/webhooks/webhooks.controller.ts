import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EfiWebhookGuard } from './efi-webhook.guard';
import { WebhooksService } from './webhooks.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('meta')
  verifyMetaWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    try {
      return this.webhooksService.verifyMetaWebhook({
        mode,
        verifyToken,
        challenge,
      });
    } catch {
      throw new HttpException('Nao autorizado', HttpStatus.FORBIDDEN);
    }
  }

  @Post('meta')
  async handleMetaWebhook(
    @Body() payload: unknown,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: RawBodyRequest,
  ) {
    try {
      return await this.webhooksService.handleMetaWebhook(
        payload,
        signature,
        request.rawBody,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Nao autorizado') {
        throw new HttpException('Nao autorizado', HttpStatus.UNAUTHORIZED);
      }
      this.logger.error(
        'Erro ao processar webhook Meta:',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
  @UseGuards(EfiWebhookGuard)
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
  @UseGuards(EfiWebhookGuard)
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
