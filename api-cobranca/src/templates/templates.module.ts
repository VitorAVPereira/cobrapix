import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { WhatsappTransportModule } from '../whatsapp/transport/whatsapp-transport.module';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';
import { TemplateMappingService } from './template-mapping.service';
import { TemplateRenderingModule } from './template-rendering.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    WhatsappTransportModule,
    TemplateRenderingModule,
  ],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    TemplateCatalogSyncService,
    TemplateMappingService,
    PlatformAdminGuard,
  ],
  exports: [
    TemplatesService,
    TemplateCatalogSyncService,
    TemplateMappingService,
  ],
})
export class TemplatesModule {}
