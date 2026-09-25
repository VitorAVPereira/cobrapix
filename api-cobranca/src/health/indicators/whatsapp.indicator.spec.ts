import { ConfigService } from '@nestjs/config';
import { WhatsappHealthIndicator } from './whatsapp.indicator';

const complete = {
  DATAFY_API_TOKEN: 'sk_live_test_only',
  DATAFY_WEBHOOK_SECRET: 'whsec_test_only',
  META_PHONE_NUMBER_ID: '123',
  META_BUSINESS_ACCOUNT_ID: '456',
  DATAFY_WEBHOOK_BASE_URL: 'https://api.example.test/webhooks/datafy',
};

describe('WhatsApp health local', () => {
  afterEach(() => jest.restoreAllMocks());

  it('informa configuracao completa sem confundir com autenticacao verificada', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const result = new WhatsappHealthIndicator(
      new ConfigService(complete),
    ).check();
    expect(result).toMatchObject({
      status: 'healthy',
      details: {
        transport: 'DATAFY',
        configured: true,
        authentication: 'NOT_CHECKED',
        webhookSupported: true,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('sk_live_test_only');
  });

  it('fica unhealthy com configuracao Datafy incompleta', () => {
    const result = new WhatsappHealthIndicator(
      new ConfigService({ ...complete, DATAFY_WEBHOOK_SECRET: '' }),
    ).check();
    expect(result).toMatchObject({
      status: 'unhealthy',
      details: { configured: false },
    });
  });
});
