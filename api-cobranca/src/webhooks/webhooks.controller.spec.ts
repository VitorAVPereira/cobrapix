import { HttpException, HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { EmailService } from '../email/email.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

type ResendWebhookHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

type ResendWebhookResult = {
  processed: boolean;
  eventType: string;
};

type HandleWebhookEvent = (
  payload: Buffer,
  headers: ResendWebhookHeaders,
) => Promise<ResendWebhookResult>;

function createController(options?: { emailError?: Error }): {
  controller: WebhooksController;
  emailService: {
    handleWebhookEvent: jest.MockedFunction<HandleWebhookEvent>;
  };
} {
  const webhooksService = {} as WebhooksService;
  const handleWebhookEvent: jest.MockedFunction<HandleWebhookEvent> = jest.fn(
    (): Promise<ResendWebhookResult> => {
      if (options?.emailError) {
        return Promise.reject(options.emailError);
      }

      return Promise.resolve({ processed: true, eventType: 'delivered' });
    },
  );
  const emailService = {
    handleWebhookEvent,
  } as unknown as EmailService;

  return {
    controller: new WebhooksController(webhooksService, emailService),
    emailService: { handleWebhookEvent },
  };
}

async function expectHttpException(
  action: Promise<unknown>,
  expectedMessage: string,
  expectedStatus: HttpStatus,
): Promise<void> {
  try {
    await action;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);

    const exception = error as HttpException;
    expect(exception.message).toBe(expectedMessage);
    expect(exception.getStatus()).toBe(expectedStatus);
    return;
  }

  throw new Error('Expected HttpException to be thrown');
}

describe('WebhooksController', () => {
  it('expoe POST /webhooks/resend no modulo de webhooks', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      WebhooksController.prototype,
      'handleResendWebhook',
    ) as
      | TypedPropertyDescriptor<WebhooksController['handleResendWebhook']>
      | undefined;
    const handler = descriptor?.value;

    expect(Reflect.getMetadata(PATH_METADATA, WebhooksController)).toBe(
      'webhooks',
    );
    expect(handler).toEqual(expect.any(Function));
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('resend');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('encaminha raw body e headers Svix para o EmailService', async () => {
    const { controller, emailService } = createController();
    const rawBody = Buffer.from('{"type":"email.delivered"}', 'utf8');

    await expect(
      controller.handleResendWebhook(
        { type: 'email.delivered' },
        'msg_123',
        '1780000000',
        'v1,signature',
        { rawBody } as never,
      ),
    ).resolves.toEqual({ processed: true, eventType: 'delivered' });

    expect(emailService.handleWebhookEvent).toHaveBeenCalledWith(rawBody, {
      id: 'msg_123',
      timestamp: '1780000000',
      signature: 'v1,signature',
    });
  });

  it('retorna 401 para webhook Resend sem assinatura valida', async () => {
    const { controller } = createController({
      emailError: new Error('Webhook Resend: assinatura ausente'),
    });

    await expectHttpException(
      controller.handleResendWebhook({}, undefined, undefined, undefined, {
        rawBody: Buffer.from('{}', 'utf8'),
      } as never),
      'Nao autorizado',
      HttpStatus.UNAUTHORIZED,
    );
  });

  it('retorna 400 para payload Resend malformado', async () => {
    const { controller } = createController({
      emailError: new Error(
        'Payload webhook Resend invalido: JSON mal formado',
      ),
    });

    await expectHttpException(
      controller.handleResendWebhook(
        {},
        'msg_bad_payload',
        undefined,
        undefined,
        { rawBody: Buffer.from('{', 'utf8') } as never,
      ),
      'Payload invalido',
      HttpStatus.BAD_REQUEST,
    );
  });

  it('retorna 400 para payload Resend sem type ou data.email_id', async () => {
    const { controller } = createController({
      emailError: new Error('Payload webhook Resend sem type ou data.email_id'),
    });

    await expectHttpException(
      controller.handleResendWebhook(
        {},
        'msg_missing_fields',
        '1780000000',
        'v1,signature',
        { rawBody: Buffer.from('{}', 'utf8') } as never,
      ),
      'Payload invalido',
      HttpStatus.BAD_REQUEST,
    );
  });

  it('retorna 500 para erro inesperado do EmailService', async () => {
    const { controller } = createController({
      emailError: new Error('erro inesperado no processamento'),
    });

    await expectHttpException(
      controller.handleResendWebhook(
        {},
        'msg_unexpected_error',
        '1780000000',
        'v1,signature',
        { rawBody: Buffer.from('{}', 'utf8') } as never,
      ),
      'Falha ao processar webhook',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});
