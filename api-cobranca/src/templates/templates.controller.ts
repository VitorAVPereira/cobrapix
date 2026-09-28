import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { UpdateTemplateDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';

/** WhatsApp templates are authored in Meta; the old creation routes never reach the provider. */
function authoringMoved(): never {
  throw new HttpException(
    {
      code: 'TEMPLATE_AUTHORING_MOVED_TO_META',
      message:
        'Templates WhatsApp são criados na Meta e importados pelo catálogo administrativo.',
    },
    HttpStatus.GONE,
  );
}

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly catalogSync: TemplateCatalogSyncService,
  ) {}

  @Post()
  @UseGuards(PlatformAdminGuard)
  create(): never {
    return authoringMoved();
  }

  @Post('sync-meta')
  @UseGuards(PlatformAdminGuard)
  async syncMetaStatuses() {
    return this.catalogSync.sync('MANUAL');
  }

  @Get()
  async findAll(@GetUser() user: { companyId: string }) {
    return this.templatesService.findAll(user.companyId);
  }

  @Get(':id')
  async findOne(
    @GetUser() user: { companyId: string },
    @Param('id') id: string,
  ) {
    return this.templatesService.findOne(user.companyId, id);
  }

  @Put(':id')
  async update(
    @GetUser() user: { companyId: string },
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(user.companyId, id, dto);
  }

  @Post(':id/submit-meta')
  @UseGuards(PlatformAdminGuard)
  submitToMeta(): never {
    return authoringMoved();
  }

  @Post(':id/review')
  @UseGuards(PlatformAdminGuard)
  confirmReview(): never {
    return authoringMoved();
  }
}
