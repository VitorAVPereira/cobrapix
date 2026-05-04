import { HealthService } from './health.service';
import type { DatabaseHealthIndicator } from './indicators/database.indicator';
import type { MetaHealthIndicator } from './indicators/meta.indicator';
import type { HealthCheckResult, HealthStatus } from './types';

/**
 * Testa a agregação de status do HealthService mockando os indicators.
 * Os indicators têm testes próprios (follow-up) — aqui nos interessa só
 * a lógica "all healthy / some healthy / none healthy".
 */
describe('HealthService', () => {
  const buildService = (
    dbStatus: HealthStatus,
    metaStatus: HealthStatus,
  ): HealthService => {
    const db: Pick<DatabaseHealthIndicator, 'check'> = {
      check: jest.fn().mockResolvedValue({
        service: 'Database',
        status: dbStatus,
        message: 'mock',
      } satisfies HealthCheckResult),
    };
    const meta: Pick<MetaHealthIndicator, 'check'> = {
      check: jest.fn().mockReturnValue({
        service: 'Meta Cloud API',
        status: metaStatus,
        message: 'mock',
      } satisfies HealthCheckResult),
    };
    return new HealthService(
      db as DatabaseHealthIndicator,
      meta as MetaHealthIndicator,
    );
  };

  it('retorna healthy quando ambos os checks estão healthy', async () => {
    const result = await buildService('healthy', 'healthy').runAll();
    expect(result.overall).toBe('healthy');
    expect(result.checks).toHaveLength(2);
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
});
