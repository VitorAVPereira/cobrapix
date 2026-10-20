import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AdminCatalogQueryDto,
  PreviewTemplateMappingDto,
  SaveTemplateMappingDto,
  SetTemplateDefaultDto,
  SetTemplateGrantDto,
} from './dto';
import { TemplateCatalogQueryService } from './template-catalog-query.service';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';
import { TemplateMappingService } from './template-mapping.service';
import { CompanyTemplateAccessService } from './company-template-access.service';
import { CollectionTemplateSlotService } from './collection-template-slot.service';
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  TEMPLATE_PURPOSES,
  TemplatePurpose,
  type CollectionSlotMethod,
} from './template-contracts';

/**
 * Global catalog administration. The actor always comes from the session; static routes
 * are declared before parameterized ones.
 */
@Controller('admin/whatsapp-templates')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminTemplatesController {
  constructor(
    private readonly catalog: TemplateCatalogQueryService,
    private readonly sync: TemplateCatalogSyncService,
    private readonly mappings: TemplateMappingService,
    private readonly access: CompanyTemplateAccessService,
    private readonly slots: CollectionTemplateSlotService,
  ) {}

  @Get()
  list(@Query() query: AdminCatalogQueryDto) {
    return this.catalog.adminCatalog(query);
  }

  @Get('sync-state')
  syncState() {
    return this.catalog.syncState();
  }

  @Post('sync')
  syncNow() {
    return this.sync.sync('MANUAL');
  }

  @Get('collection-slots')
  collectionSlots() {
    return this.slots.list();
  }

  @Put('collection-slots/:purpose/:method')
  setCollectionSlot(
    @GetUser() user: AuthenticatedUser,
    @Param('purpose') purpose: string,
    @Param('method') method: string,
    @Body() dto: SetTemplateDefaultDto,
  ) {
    if (!COLLECTION_PURPOSES.includes(purpose as TemplatePurpose))
      throw new BadRequestException('Momento de cobrança inválido.');
    if (!(COLLECTION_SLOT_METHODS as readonly string[]).includes(method))
      throw new BadRequestException('Forma de pagamento inválida.');
    return this.slots.set(
      purpose as TemplatePurpose,
      method as CollectionSlotMethod,
      dto.templateId,
      dto.expectedVersion,
      user.userId,
    );
  }

  @Get('companies/:companyId')
  company(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.catalog.companyAccess(companyId);
  }

  @Put('companies/:companyId/grants/:templateId')
  setGrant(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: SetTemplateGrantDto,
  ) {
    return this.access.setGrant(
      companyId,
      templateId,
      dto.enabled,
      dto.expectedVersion,
      user.userId,
    );
  }

  @Put('companies/:companyId/defaults/:purpose')
  setDefault(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('purpose') purpose: string,
    @Body() dto: SetTemplateDefaultDto,
  ) {
    if (!(TEMPLATE_PURPOSES as readonly string[]).includes(purpose))
      throw new BadRequestException('Finalidade inválida.');
    return this.access.setDefault(
      companyId,
      purpose as TemplatePurpose,
      dto.templateId,
      dto.expectedVersion,
      user.userId,
    );
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.adminTemplate(id);
  }

  @Put(':id/mapping')
  saveMapping(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveTemplateMappingDto,
  ) {
    return this.mappings.save(
      id,
      dto.expectedProviderRevision,
      dto.expectedMappingRevision,
      dto.mapping,
      user.userId,
    );
  }

  @Post(':id/preview')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewTemplateMappingDto,
  ) {
    return this.mappings.preview(id, dto.mapping);
  }
}
