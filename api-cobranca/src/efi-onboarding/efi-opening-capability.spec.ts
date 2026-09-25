import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { EfiOpeningClient, EfiOpeningTransport } from './efi-opening.client';
import { EfiOpeningWebhookController } from './efi-onboarding.controller';
import { EfiOnboardingService } from './efi-onboarding.service';
import { OnboardingAdminService } from './onboarding-admin.service';
import { OnboardingLifecycle } from './onboarding-lifecycle';
import { OnboardingMaintenance } from './onboarding-maintenance';
import { OnboardingWorker } from './onboarding-worker';
import type { OnboardingJob } from './onboarding-jobs';

describe('EFI_OPENING_ENABLED=false', () => {
  const config = new ConfigService({
    EFI_OPENING_ENABLED: 'false',
    EFI_ENV: 'homologation',
    EFI_OPENING_CLIENT_ID: 'client',
    EFI_OPENING_CLIENT_SECRET: 'secret',
    EFI_OPENING_CERT_PATH: '/cert.p12',
  });
  // Any access fails the test: disabled opening must not touch the database.
  const untouchable = new Proxy(
    {},
    {
      get(): never {
        throw new Error('UNEXPECTED_ACCESS');
      },
    },
  );
  const status = (error: unknown): number | undefined =>
    error instanceof HttpException ? error.getStatus() : undefined;
  const code = (error: unknown): unknown =>
    error instanceof HttpException
      ? (error.getResponse() as { code?: string }).code
      : undefined;

  it('o cliente não chega a autenticar na API de abertura', async () => {
    const request = jest.fn();
    const client = new EfiOpeningClient(config, {
      request,
    } as unknown as EfiOpeningTransport);
    await expect(client.getCredentials('request-id')).rejects.toMatchObject({
      code: 'EFI_OPENING_DISABLED',
      uncertain: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('o worker conclui os jobs sem executar a abertura', async () => {
    const step = jest.fn();
    const worker = new OnboardingWorker(
      { submit: step } as never,
      { run: step } as never,
      { reconcile: step } as never,
      { remind: step } as never,
      config,
    );
    for (const name of ['submit', 'provision', 'reconcile', 'remind'])
      await worker.process({
        name,
        data: { companyId: 'c', attempt: 0 },
      } as Job<OnboardingJob>);
    expect(step).not.toHaveBeenCalled();
  });

  it('as rotinas de recuperação e renovação por abertura não rodam', async () => {
    await new OnboardingMaintenance(
      untouchable as never,
      untouchable as never,
      untouchable as never,
      untouchable as never,
      config,
    ).recover();
    await new OnboardingLifecycle(
      untouchable as never,
      untouchable as never,
      untouchable as never,
      untouchable as never,
      untouchable as never,
      untouchable as never,
      config,
    ).certificates();
  });

  it('webhook, envio da empresa e ações do admin respondem 503', async () => {
    const attempts: Array<() => Promise<unknown>> = [
      () =>
        new EfiOpeningWebhookController(untouchable as never, config).handle(
          {},
        ),
      () =>
        new EfiOnboardingService(
          untouchable as never,
          untouchable as never,
          config,
          untouchable as never,
        ).submit({
          userId: 'u',
          email: 'u@example.test',
          companyId: 'c',
          role: 'COMPANY_ADMIN',
          mustChangePassword: false,
          tokenVersion: 0,
        }),
    ];
    const admin = new OnboardingAdminService(
      untouchable as never,
      untouchable as never,
      config,
      untouchable as never,
      untouchable as never,
      untouchable as never,
    );
    attempts.push(
      () => admin.setEnabled('EFI_ONBOARDING', true),
      () => admin.retry('c', 'u'),
      () => admin.manual('c', 'u', { requestId: 'r' }),
    );
    for (const attempt of attempts) {
      const error: unknown = await attempt().catch((e: unknown) => e);
      expect(status(error)).toBe(503);
      expect(code(error)).toBe('EFI_OPENING_DISABLED');
    }
  });
});
