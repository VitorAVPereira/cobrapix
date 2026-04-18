import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { EvolutionHealthIndicator } from './indicators/evolution.indicator';

@Module({
  controllers: [HealthController],
  providers: [HealthService, DatabaseHealthIndicator, EvolutionHealthIndicator],
})
export class HealthModule {}
