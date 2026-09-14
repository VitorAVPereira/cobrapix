import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';

@Module({
  imports: [PrismaModule, WhatsappModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, PlatformAdminGuard],
  exports: [TemplatesService],
})
export class TemplatesModule {}
