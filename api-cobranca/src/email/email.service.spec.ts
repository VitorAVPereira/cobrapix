import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';

type WebhookAttemptStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'OPENED'
  | 'CLICKED'
  | 'FAILED';

interface WebhookTransactionMock {
  emailEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  collectionAttempt: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
}

function buildEmailInput(): Parameters<EmailService['send']>[0] {
  return {
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    debtorId: 'debtor-1',
    debtorName: 'Maria Silva',
    email: 'responsavel@familia.com',
    subject: '[Escola Teste] Cobranca pendente',
    html: '<p>Cobranca pendente</p>',
    ruleStepId: 'step-1',
  };
}

function createService(company: {
  corporateName: string;
  resendApiKeyEncrypted: string | null;
  resendFromEmail: string | null;
}) {
  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue(company),
    },
    collectionAttempt: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
    },
  } as unknown as PrismaService;
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;
  const crypto = {
    decrypt: jest.fn().mockReturnValue('re_cliente_123'),
  } as unknown as PaymentCryptoService;
  const resendMailer = {
    sendEmail: jest.fn().mockResolvedValue({ id: 'email-123' }),
  } as unknown as ResendMailerService;

  return {
    service: new EmailService(configService, prisma, crypto, resendMailer),
    prisma: prisma as unknown as {
      collectionAttempt: { upsert: jest.Mock };
    },
    crypto: crypto as unknown as { decrypt: jest.Mock },
    resendMailer: resendMailer as unknown as {
      sendEmail: jest.Mock;
    },
  };
}

function buildWebhookPayload(type: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      type,
      created_at: '2026-05-27T10:01:00.000Z',
      data: {
        email_id: 'email-123',
        created_at: '2026-05-27T10:00:00.000Z',
        from: 'Escola Teste <cobranca@escolateste.com.br>',
        to: ['responsavel@familia.com'],
        subject: 'Cobranca pendente',
      },
    }),
    'utf8',
  );
}

function createWebhookService(options?: {
  webhookSecret?: string;
  companyWebhookSecretEncrypted?: string | null;
  verifiedPayload?: Record<string, unknown>;
  attemptStatus?: WebhookAttemptStatus;
  nodeEnv?: 'development' | 'test' | 'production';
}) {
  const emailEventFindUnique = jest.fn().mockResolvedValue(null);
  const emailEventCreate = jest.fn().mockResolvedValue({ id: 'event-1' });
  const collectionAttemptFindFirst = jest.fn().mockResolvedValue({
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    status: options?.attemptStatus ?? 'SENT',
  });
  const collectionAttemptUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const transactionClient: WebhookTransactionMock = {
    emailEvent: {
      findUnique: emailEventFindUnique,
      create: emailEventCreate,
    },
    collectionAttempt: {
      findFirst: collectionAttemptFindFirst,
      updateMany: collectionAttemptUpdateMany,
    },
  };
  const rootEmailEventFindUnique = jest.fn();
  const rootEmailEventCreate = jest.fn();
  const rootCollectionAttemptFindFirst = jest.fn();
  const rootCollectionAttemptUpdateMany = jest.fn();
  const transaction = jest.fn(
    <T>(callback: (client: WebhookTransactionMock) => Promise<T>): Promise<T> =>
      callback(transactionClient),
  );
  const prisma = {
    $transaction: transaction,
    company: {
      findUnique: jest.fn().mockResolvedValue({
        resendWebhookSecretEncrypted:
          options?.companyWebhookSecretEncrypted ?? null,
      }),
    },
    emailEvent: {
      findUnique: rootEmailEventFindUnique,
      create: rootEmailEventCreate,
    },
    collectionAttempt: {
      findFirst: rootCollectionAttemptFindFirst,
      updateMany: rootCollectionAttemptUpdateMany,
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as PrismaService;
  const configService = {
    get: jest.fn((key: string): string | undefined => {
      if (key === 'RESEND_WEBHOOK_SECRET') return options?.webhookSecret;
      if (key === 'NODE_ENV') return options?.nodeEnv ?? 'test';
      return undefined;
    }),
  } as unknown as ConfigService;
  const crypto = {
    decrypt: jest.fn().mockReturnValue('whsec_company_decrypted'),
  } as unknown as PaymentCryptoService;
  const resendMailer = {
    sendEmail: jest.fn(),
    verifyWebhookEvent: jest.fn().mockReturnValue(options?.verifiedPayload),
  } as unknown as ResendMailerService;

  return {
    service: new EmailService(configService, prisma, crypto, resendMailer),
    prisma: {
      emailEventFindUnique,
      emailEventCreate,
      collectionAttemptFindFirst,
      collectionAttemptUpdateMany,
      transaction,
      rootEmailEventFindUnique,
      rootEmailEventCreate,
      rootCollectionAttemptFindFirst,
      rootCollectionAttemptUpdateMany,
      companyFindUnique: (
        prisma as unknown as {
          company: { findUnique: jest.Mock };
        }
      ).company.findUnique,
    },
    crypto: crypto as unknown as { decrypt: jest.Mock },
    resendMailer: resendMailer as unknown as {
      verifyWebhookEvent: jest.Mock;
    },
  };
}

describe('EmailService', () => {
  it('envia cobranca com a conta Resend e remetente da empresa', async () => {
    const { service, prisma, crypto, resendMailer } = createService({
      corporateName: 'Escola Teste',
      resendApiKeyEncrypted: 'encrypted-resend-key',
      resendFromEmail: 'cobranca@escolateste.com.br',
    });

    const messageId = await service.send(buildEmailInput());

    expect(messageId).toBe('email-123');
    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted-resend-key');
    expect(resendMailer.sendEmail).toHaveBeenCalledWith({
      apiKey: 're_cliente_123',
      from: 'Escola Teste <cobranca@escolateste.com.br>',
      to: ['responsavel@familia.com'],
      subject: '[Escola Teste] Cobranca pendente',
      html: '<p>Cobranca pendente</p>',
    });
    expect(prisma.collectionAttempt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          externalMessageId: 'email-123',
        }) as unknown,
      }),
    );
  });

  it('falha antes do envio quando o remetente Resend da empresa nao foi configurado', async () => {
    const { service, crypto, resendMailer } = createService({
      corporateName: 'Escola Teste',
      resendApiKeyEncrypted: 'encrypted-resend-key',
      resendFromEmail: null,
    });

    await expect(service.send(buildEmailInput())).rejects.toThrow(
      'Remetente Resend nao configurado para esta empresa.',
    );
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(resendMailer.sendEmail).not.toHaveBeenCalled();
  });

  it('processa webhook entregue e atualiza somente a tentativa da empresa', async () => {
    const { service, prisma } = createWebhookService();

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_123' },
    );

    expect(result).toEqual({ processed: true, eventType: 'delivered' });
    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rootEmailEventCreate).not.toHaveBeenCalled();
    expect(prisma.rootCollectionAttemptUpdateMany).not.toHaveBeenCalled();
    expect(prisma.emailEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          svixId: 'msg_123',
          emailMessageId: 'email-123',
          eventType: 'delivered',
          invoiceId: 'invoice-1',
          recipientEmail: 'responsavel@familia.com',
        }) as unknown,
      }),
    );
    expect(prisma.collectionAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        externalMessageId: 'email-123',
        companyId: 'company-1',
        channel: 'EMAIL',
        status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
      },
      data: { status: 'DELIVERED' },
    });
  });

  it('marca tentativa como falha quando webhook informa reclamacao de spam', async () => {
    const { service, prisma } = createWebhookService({
      attemptStatus: 'DELIVERED',
    });

    await service.handleWebhookEvent(buildWebhookPayload('email.complained'), {
      id: 'msg_456',
    });

    expect(prisma.collectionAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        externalMessageId: 'email-123',
        companyId: 'company-1',
        channel: 'EMAIL',
        status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'FAILED'] },
      },
      data: { status: 'FAILED' },
    });
  });

  it('usa o SDK do Resend para validar webhook quando ha segredo configurado', async () => {
    const verifiedPayload = JSON.parse(
      buildWebhookPayload('email.opened').toString('utf8'),
    ) as Record<string, unknown>;
    const rawBody = Buffer.from('{"raw":true}', 'utf8');
    const { service, resendMailer } = createWebhookService({
      webhookSecret: 'whsec_test',
      verifiedPayload,
      attemptStatus: 'DELIVERED',
    });

    await service.handleWebhookEvent(rawBody, {
      id: 'msg_789',
      timestamp: '1780000000',
      signature: 'v1,signature',
    });

    expect(resendMailer.verifyWebhookEvent).toHaveBeenCalledWith({
      payload: rawBody.toString('utf8'),
      headers: {
        id: 'msg_789',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      webhookSecret: 'whsec_test',
    });
  });

  it('usa o signing secret criptografado da empresa no webhook por cliente', async () => {
    const verifiedPayload = JSON.parse(
      buildWebhookPayload('email.clicked').toString('utf8'),
    ) as Record<string, unknown>;
    const rawBody = Buffer.from('{"raw":true}', 'utf8');
    const { service, prisma, crypto, resendMailer } = createWebhookService({
      companyWebhookSecretEncrypted: 'encrypted-company-whsec',
      verifiedPayload,
      attemptStatus: 'OPENED',
    });

    await service.handleWebhookEvent(
      rawBody,
      {
        id: 'msg_company_webhook',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      'company-1',
    );

    expect(prisma.companyFindUnique).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      select: { resendWebhookSecretEncrypted: true },
    });
    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted-company-whsec');
    expect(resendMailer.verifyWebhookEvent).toHaveBeenCalledWith({
      payload: rawBody.toString('utf8'),
      headers: {
        id: 'msg_company_webhook',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      webhookSecret: 'whsec_company_decrypted',
    });
    expect(prisma.collectionAttemptFindFirst).toHaveBeenCalledWith({
      where: {
        externalMessageId: 'email-123',
        channel: 'EMAIL',
        companyId: 'company-1',
      },
      select: { companyId: true, invoiceId: true, status: true },
    });
  });

  it('falha fechado em producao quando RESEND_WEBHOOK_SECRET nao esta configurado', async () => {
    const { service, resendMailer } = createWebhookService({
      nodeEnv: 'production',
    });

    await expect(
      service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {
        id: 'msg_prod_missing_secret',
      }),
    ).rejects.toThrow('Webhook Resend: assinatura obrigatoria em producao');

    expect(resendMailer.verifyWebhookEvent).not.toHaveBeenCalled();
  });

  it('trata svix-id ausente como erro de assinatura', async () => {
    const { service } = createWebhookService();

    await expect(
      service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {}),
    ).rejects.toThrow('Webhook Resend: assinatura ausente');
  });

  it('ignora entrega duplicada pelo mesmo svix-id sem criar novo evento', async () => {
    const { service, prisma } = createWebhookService();
    prisma.emailEventFindUnique.mockResolvedValueOnce({ id: 'event-existing' });

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_duplicate' },
    );

    expect(result).toEqual({ processed: true, eventType: 'delivered' });
    expect(prisma.emailEventCreate).not.toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('aceita conflito unico no create do evento como duplicado sem atualizar tentativa', async () => {
    const { service, prisma } = createWebhookService();
    const uniqueConflict = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    };
    prisma.emailEventCreate.mockRejectedValueOnce(uniqueConflict);

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_concurrent_duplicate' },
    );

    expect(result).toEqual({ processed: true, eventType: 'delivered' });
    expect(prisma.emailEventCreate).toHaveBeenCalledTimes(1);
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('nao rebaixa status CLICKED quando chega evento delivered atrasado', async () => {
    const { service, prisma } = createWebhookService({
      attemptStatus: 'CLICKED',
    });

    await service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {
      id: 'msg_delivered_after_clicked',
    });

    expect(prisma.emailEventCreate).toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('nao reativa tentativa FAILED quando chega evento delivered atrasado', async () => {
    const { service, prisma } = createWebhookService({
      attemptStatus: 'FAILED',
    });

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_delivered_after_failed' },
    );

    expect(result).toEqual({ processed: true, eventType: 'delivered' });
    expect(prisma.emailEventCreate).toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('retorna processed false quando o email_id nao pertence a tentativa conhecida', async () => {
    const { service, prisma } = createWebhookService();
    prisma.collectionAttemptFindFirst.mockResolvedValueOnce(null);

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_unknown_email_id' },
    );

    expect(result).toEqual({ processed: false, eventType: 'delivered' });
    expect(prisma.emailEventCreate).not.toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });
});
