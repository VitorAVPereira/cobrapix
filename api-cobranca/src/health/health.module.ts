import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MetaHealthIndicator } from './indicators/meta.indicator';

@Module({
  controllers: [HealthController],
  providers: [HealthService, DatabaseHealthIndicator, MetaHealthIndicator],
})
export class HealthModule {}
