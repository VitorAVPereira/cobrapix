import { HealthService } from './health.service';
import type { DatabaseHealthIndicator } from './indicators/database.indicator';
import type { WhatsappHealthIndicator } from './indicators/whatsapp.indicator';
import type { CommunicationMediaHealthIndicator } from './indicators/communication-media.indicator';
import type { HealthCheckResult, HealthStatus } from './types';

/**
 * Testa a agregação de status do HealthService mockando os indicators.
 * Os indicators têm testes próprios (follow-up) — aqui nos interessa só
 * a lógica "all healthy / some healthy / none healthy".
 */
describe('HealthService', () => {
  const buildService = (
    dbStatus: HealthStatus,
    whatsappStatus: HealthStatus,
    mediaStatus: HealthStatus = 'healthy',
  ): HealthService => {
    const db: Pick<DatabaseHealthIndicator, 'check'> = {
      check: jest.fn().mockResolvedValue({
        service: 'Database',
        status: dbStatus,
        message: 'mock',
      } satisfies HealthCheckResult),
    };
    const whatsapp: Pick<WhatsappHealthIndicator, 'check'> = {
      check: jest.fn().mockReturnValue({
        service: 'WhatsApp via Datafy',
        status: whatsappStatus,
        message: 'mock',
      } satisfies HealthCheckResult),
    };
    const media: Pick<CommunicationMediaHealthIndicator, 'check'> = {
      check: jest.fn().mockResolvedValue({
        service: 'Anexos',
        status: mediaStatus,
        message: 'mock',
      } satisfies HealthCheckResult),
    };
    return new HealthService(
      db as DatabaseHealthIndicator,
      whatsapp as WhatsappHealthIndicator,
      media as CommunicationMediaHealthIndicator,
    );
  };

  it('retorna healthy quando ambos os checks estão healthy', async () => {
    const result = await buildService('healthy', 'healthy').runAll();
    expect(result.overall).toBe('healthy');
    expect(result.checks).toHaveLength(3);
  });

  it('retorna degraded quando um está healthy e outro unhealthy', async () => {
    const dbDown = await buildService('unhealthy', 'healthy').runAll();
    expect(dbDown.overall).toBe('degraded');

    const evoDown = await buildService('healthy', 'unhealthy').runAll();
    expect(evoDown.overall).toBe('degraded');
  });

  it('retorna unhealthy quando ambos os checks falharam', async () => {
    const result = await buildService('unhealthy', 'unhealthy').runAll();
    expect(result.overall).toBe('unhealthy');
  });

  it('never lets healthy attachment storage mask core failures', async () => {
    const result = await buildService(
      'unhealthy',
      'unhealthy',
      'healthy',
    ).runAll();
    expect(result.overall).toBe('unhealthy');
  });

  it('degrades when attachment storage needs attention', async () => {
    const result = await buildService('healthy', 'healthy', 'unknown').runAll();
    expect(result.overall).toBe('degraded');
  });
});
