import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';
import { TemplateCatalogQueryService } from './template-catalog-query.service';
import { CatalogPageQueryDto } from './dto';

/** WhatsApp templates are authored in Meta; the old authoring routes never reach the provider. */
function authoringMoved(): never {
  throw new HttpException(
    {
      code: 'TEMPLATE_AUTHORING_MOVED_TO_META',
      message:
        'Templates WhatsApp são criados na Meta e configurados no catálogo administrativo; atualize o painel.',
    },
    HttpStatus.GONE,
  );
}

/**
 * Company view: only templates granted to the authenticated company and usable now.
 * The company is always the session's; a foreign ID is simply not found.
 */
@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(
    private readonly catalog: TemplateCatalogQueryService,
    private readonly catalogSync: TemplateCatalogSyncService,
  ) {}

  @Get()
  list(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CatalogPageQueryDto,
  ) {
    return this.catalog.companyCatalog(user.companyId, query);
  }

  @Post()
  create(): never {
    return authoringMoved();
  }

  /** Legacy admin sync route; answers with the new sync result. */
  @Post('sync-meta')
  @UseGuards(PlatformAdminGuard)
  syncMetaStatuses() {
    return this.catalogSync.sync('MANUAL');
  }

  @Get(':id')
  get(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.companyTemplate(user.companyId, id);
  }

  @Get(':id/preview')
  preview(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.companyPreview(user.companyId, id);
  }

  /** Company personalization of WhatsApp text no longer exists. */
  @Put(':id')
  update(): never {
    return authoringMoved();
  }

  @Post(':id/submit-meta')
  submitToMeta(): never {
    return authoringMoved();
  }

  @Post(':id/review')
  confirmReview(): never {
    return authoringMoved();
  }
}
