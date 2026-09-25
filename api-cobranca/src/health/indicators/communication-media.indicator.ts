import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MEDIA_ALERT_RATIO,
  mediaLimitBytes,
  mediaRoot,
} from '../../communications/communication-media.service';
import type { HealthCheckResult } from '../types';

const CACHE_MS = 60_000;

/**
 * Private attachment storage: directory writable and usage against the operational
 * limit (alert from 80%). Cached so frequent Docker probes do not query every time.
 * Never "unhealthy" enough to fail the probe alone: the overall status becomes degraded.
 */
@Injectable()
export class CommunicationMediaHealthIndicator {
  private cached: { at: number; result: HealthCheckResult } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthCheckResult> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS)
      return this.cached.result;
    const result = await this.evaluate();
    this.cached = { at: Date.now(), result };
    return result;
  }

  private async evaluate(): Promise<HealthCheckResult> {
    const service = 'Anexos de comunicação';
    const limitBytes = mediaLimitBytes(this.config);
    let writable = true;
    try {
      await access(mediaRoot(this.config), constants.W_OK);
    } catch {
      writable = false;
    }
    let usedBytes: number;
    try {
      const sum = await this.prisma.communicationAttachment.aggregate({
        where: { state: 'READY' },
        _sum: { sizeBytes: true },
      });
      usedBytes = sum._sum.sizeBytes ?? 0;
    } catch {
      return {
        service,
        status: 'unknown',
        message: 'Uso do armazenamento indisponível.',
      };
    }
    const ratio = usedBytes / limitBytes;
    const details = {
      usedBytes,
      limitBytes,
      ratio: Number(ratio.toFixed(4)),
      writable,
    };
    if (!writable && this.config.get<string>('NODE_ENV') === 'production')
      return {
        service,
        status: 'unhealthy',
        message:
          'Diretório privado de anexos ausente ou sem permissão de escrita.',
        details,
      };
    if (ratio >= 1)
      return {
        service,
        status: 'unhealthy',
        message:
          'Limite de armazenamento de anexos atingido; novos anexos ficam indisponíveis.',
        details,
      };
    if (ratio >= MEDIA_ALERT_RATIO)
      return {
        service,
        status: 'unknown',
        message: 'Armazenamento de anexos acima de 80% do limite.',
        details,
      };
    return {
      service,
      status: 'healthy',
      message: 'Armazenamento de anexos disponível.',
      details,
    };
  }
}
