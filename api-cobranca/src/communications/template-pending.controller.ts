import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TemplatePendingService } from './template-pending.service';
import { TemplateResumeService } from './template-resume.service';
import {
  CompanyTemplatePendingQueryDto,
  ConfirmResumeDto,
  ResumePreviewDto,
  TemplatePendingQueryDto,
} from './dto/template-resume.dto';

/** Admin review of held template sends: listing, preview and confirmed resumes. */
@Controller('communications/admin/template-pending')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminTemplatePendingController {
  constructor(
    private readonly pending: TemplatePendingService,
    private readonly resume: TemplateResumeService,
  ) {}

  @Get()
  list(@Query() query: TemplatePendingQueryDto) {
    return this.pending.list({ kind: 'ADMIN' }, query);
  }

  @Get('summary')
  summary() {
    return this.pending.summary();
  }

  @Post('reviews')
  preview(@GetUser() user: AuthenticatedUser, @Body() dto: ResumePreviewDto) {
    return this.resume.preview(dto.items, user.userId);
  }

  @Post('reviews/:id/confirm')
  confirm(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmResumeDto,
  ) {
    return this.resume.confirm(id, dto.idempotencyId, user.userId);
  }
}

/** A company sees why its own messages are held; resuming stays with the platform admin. */
@Controller('communications/template-pending')
@UseGuards(JwtAuthGuard)
export class CompanyTemplatePendingController {
  constructor(private readonly pending: TemplatePendingService) {}

  @Get()
  list(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CompanyTemplatePendingQueryDto,
  ) {
    return this.pending.list(
      { kind: 'COMPANY', companyId: user.companyId },
      query,
    );
  }
}
