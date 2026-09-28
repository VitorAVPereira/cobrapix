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
import { TemplatePolicyModule } from './template-policy.module';
import { CompanyTemplateAccessService } from './company-template-access.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    WhatsappTransportModule,
    TemplateRenderingModule,
    TemplatePolicyModule,
  ],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    TemplateCatalogSyncService,
    TemplateMappingService,
    CompanyTemplateAccessService,
    PlatformAdminGuard,
  ],
  exports: [
    TemplatesService,
    TemplateCatalogSyncService,
    TemplateMappingService,
    CompanyTemplateAccessService,
  ],
})
export class TemplatesModule {}
