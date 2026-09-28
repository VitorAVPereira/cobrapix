import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { WhatsappTransportModule } from '../whatsapp/transport/whatsapp-transport.module';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';

@Module({
  imports: [PrismaModule, ConfigModule, WhatsappTransportModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplateCatalogSyncService, PlatformAdminGuard],
  exports: [TemplatesService, TemplateCatalogSyncService],
})
export class TemplatesModule {}
