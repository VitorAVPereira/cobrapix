import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatafyTransport } from './datafy.transport';
import { WHATSAPP_TRANSPORT } from './whatsapp-transport';
import type { WhatsappTransport } from './whatsapp-transport';
import { DatafyRateLimitService } from './datafy-rate-limit.service';

export function createWhatsappTransport(
  config: ConfigService,
  quota: DatafyRateLimitService,
): WhatsappTransport {
  return new DatafyTransport(config, quota);
}

@Module({
  imports: [ConfigModule],
  providers: [
    DatafyRateLimitService,
    {
      provide: WHATSAPP_TRANSPORT,
      inject: [ConfigService, DatafyRateLimitService],
      useFactory: createWhatsappTransport,
    },
  ],
  exports: [WHATSAPP_TRANSPORT],
})
export class WhatsappTransportModule {}
