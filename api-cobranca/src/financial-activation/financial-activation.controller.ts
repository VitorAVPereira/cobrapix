import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import {
  CancelFinancialActivationDto,
  CreateFinancialActivationDto,
  UpdateFinancialConfigurationDto,
  UploadFinancialCredentialsDto,
} from './financial-activation.dto';
import {
  CERTIFICATE_MAX_BYTES,
  FinancialActivationService,
  FinancialProfileView,
} from './financial-activation.service';
import type { UploadedCertificateFile } from './financial-activation.service';

// Only this route accepts a file. Without `dest`/`storage`, multer keeps the
// certificate in memory and never touches the filesystem.
const certificateUpload = FileInterceptor('certificate', {
  limits: {
    fileSize: CERTIFICATE_MAX_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 1024,
    parts: 11,
  },
});

@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class FinancialActivationController {
  constructor(private readonly service: FinancialActivationService) {}

  @Get('companies/:companyId/financial-profile')
  overview(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.service.getOverview(companyId);
  }

  @Post('companies/:companyId/financial-activations')
  @HttpCode(201)
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateFinancialActivationDto,
  ): Promise<FinancialProfileView> {
    return this.service.createCandidate(companyId, user.userId, dto);
  }

  @Get('financial-activations/:id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FinancialProfileView> {
    return this.service.getActivation(id);
  }

  @Put('financial-activations/:id/configuration')
  configure(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateFinancialConfigurationDto,
  ): Promise<FinancialProfileView> {
    return this.service.updateConfiguration(id, user.userId, dto);
  }

  @Put('financial-activations/:id/credentials')
  @UseInterceptors(certificateUpload)
  credentials(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UploadFinancialCredentialsDto,
    @UploadedFile() file: UploadedCertificateFile | undefined,
  ): Promise<FinancialProfileView> {
    return this.service.uploadCredentials(id, user.userId, dto, file);
  }

  @Post('financial-activations/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CancelFinancialActivationDto,
  ): Promise<FinancialProfileView> {
    return this.service.cancel(id, user.userId, dto);
  }
}
