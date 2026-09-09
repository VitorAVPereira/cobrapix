import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EfiWebhookGuard } from './efi-webhook.guard';

interface TestRequest {
  header(name: string): string | undefined;
  query: {
    token?: string | string[];
  };
}

describe('EfiWebhookGuard', () => {
  const secret = 'efi_webhook_secret_with_more_than_32_chars';

  const buildGuard = (): EfiWebhookGuard => {
    const configService: Pick<ConfigService, 'getOrThrow'> = {
      getOrThrow: jest.fn().mockReturnValue(secret),
    };

    return new EfiWebhookGuard(configService as ConfigService);
  };

  const buildContext = (request: TestRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  const buildRequest = (params: {
    headerSecret?: string;
    queryToken?: string | string[];
  }): TestRequest => ({
    header: (name: string): string | undefined =>
      name.toLowerCase() === 'x-api-key' ? params.headerSecret : undefined,
    query: {
      token: params.queryToken,
    },
  });

  it('autoriza quando x-api-key corresponde ao segredo configurado', () => {
    const guard = buildGuard();
    const context = buildContext(buildRequest({ headerSecret: secret }));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('autoriza quando query token corresponde ao segredo configurado', () => {
    const guard = buildGuard();
    const context = buildContext(buildRequest({ queryToken: secret }));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejeita quando o segredo nao foi enviado', () => {
    const guard = buildGuard();
    const context = buildContext(buildRequest({}));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejeita quando o segredo enviado nao confere', () => {
    const guard = buildGuard();
    const context = buildContext(
      buildRequest({ headerSecret: 'wrong-secret' }),
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
