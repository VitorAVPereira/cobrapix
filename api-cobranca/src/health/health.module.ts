import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { WhatsappHealthIndicator } from './indicators/whatsapp.indicator';
import { CommunicationMediaHealthIndicator } from './indicators/communication-media.indicator';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    DatabaseHealthIndicator,
    WhatsappHealthIndicator,
    CommunicationMediaHealthIndicator,
  ],
})
export class HealthModule {}
