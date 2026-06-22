import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmailService } from '../email/email.service';
import { EfiWebhookGuard } from './efi-webhook.guard';
import { WebhooksService } from './webhooks.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly emailService: EmailService,
  ) {}

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

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  async handleResendWebhook(
    @Body() payload: unknown,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
    @Req() request: RawBodyRequest,
  ): Promise<unknown> {
    return this.processResendWebhook(
      payload,
      svixId,
      svixTimestamp,
      svixSignature,
      request,
    );
  }

  @Post('resend/:companyId')
  @HttpCode(HttpStatus.OK)
  async handleCompanyResendWebhook(
    @Param('companyId') companyId: string,
    @Body() payload: unknown,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
    @Req() request: RawBodyRequest,
  ): Promise<unknown> {
    return this.processResendWebhook(
      payload,
      svixId,
      svixTimestamp,
      svixSignature,
      request,
      companyId,
    );
  }

  private async processResendWebhook(
    payload: unknown,
    svixId: string | undefined,
    svixTimestamp: string | undefined,
    svixSignature: string | undefined,
    request: RawBodyRequest,
    companyId?: string,
  ): Promise<unknown> {
    const rawBody =
      request.rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
    try {
      return await this.emailService.handleWebhookEvent(
        rawBody,
        {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        companyId,
      );
    } catch (error) {
      if (this.isResendUnauthorizedError(error)) {
        throw new HttpException('Nao autorizado', HttpStatus.UNAUTHORIZED);
      }

      if (this.isResendBadRequestError(error)) {
        throw new HttpException('Payload invalido', HttpStatus.BAD_REQUEST);
      }

      this.logger.error(
        'Erro ao processar webhook Resend:',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private isResendUnauthorizedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith('Webhook Resend: assinatura')
    );
  }

  private isResendBadRequestError(error: unknown): boolean {
    const badRequestMessages = [
      'Payload webhook Resend invalido',
      'Payload webhook Resend sem type ou data.email_id',
    ];

    return (
      error instanceof Error &&
      badRequestMessages.some((message) => error.message.startsWith(message))
    );
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
